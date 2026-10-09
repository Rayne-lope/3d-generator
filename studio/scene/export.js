// Strict scene export. Like asset export, the composed preview becomes an engine file only when
//   1. the scene and every placed asset have 0 validation errors,
//   2. composing again from scratch reproduces the preview byte for byte.
// Writes exports/<profile>/scenes/<name>.glb + .report.json + .report.md + .layout.json.

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, sha256, writeFileAtomic, writeJson } from '../core/fsutil.js';
import { rel } from '../core/paths.js';
import { STUD } from '../viewport/snap.js';
import { composeScene } from './compose.js';
import { readScene, sceneRevision } from './schema.js';
import { sceneExportPaths, sceneGlb } from './paths.js';

/** Placement data for engine-side scripts: every instance in meters and in studs. */
export function sceneLayout(name, scene, revision, items = []) {
  const studs = (v) => +(v / STUD).toFixed(4);
  return {
    schema: 1,
    scene: name,
    title: scene.title,
    revision,
    axes: { up: '+Y', front: '+Z', yaw: 'degrees around +Y, counter-clockwise seen from above' },
    room: scene.room ? { ...scene.room, studs: { width: studs(scene.room.width), depth: studs(scene.room.depth), height: studs(scene.room.height) } } : null,
    // Per placed asset: its attachments and collision shapes around its own origin, in the
    // exported file's units (present only for assets that declare them).
    items: Object.fromEntries(items.filter((it) => it.setup).map((it) => [it.item, it.setup])),
    instances: scene.instances.map((inst) => ({
      item: `${inst.asset}${inst.variant ? `--${inst.variant}` : ''}${inst.skin ? `@${inst.skin}` : ''}`,
      id: inst.id,
      asset: inst.asset,
      variant: inst.variant,
      skin: inst.skin,
      ...(inst.name ? { name: inst.name } : {}),
      ...(inst.group ? { group: inst.group } : {}),
      position: { meters: inst.position, studs: inst.position.map(studs) },
      yaw: inst.yaw,
    })),
  };
}

export function sceneReportMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.title} — scene export (${report.profile.label})`, '');
  lines.push(`- File: \`${report.file.path}\` (${(report.file.bytes / 1024).toFixed(1)} KB)`);
  lines.push(`- Size: ${report.dimensions.meters.map((v) => v.toFixed(2)).join(' × ')} m (${report.dimensions.studs.join(' × ')} studs)`);
  lines.push(`- Triangles: ${report.triangles.total.toLocaleString('en-US')} · meshes: ${report.meshCount} · instances: ${report.instanceCount}`);
  if (report.room) lines.push(`- Room: ${report.room.width} × ${report.room.depth} × ${report.room.height} m, ${report.room.openings.length} opening(s)`);
  lines.push('', '## Placed assets', '', '| Asset | Count | Triangles each | Size (m) |', '| --- | ---: | ---: | --- |');
  for (const it of report.items) lines.push(`| ${it.item} | ${it.count} | ${it.triangles?.toLocaleString('en-US') ?? '—'} | ${it.dimensions ? it.dimensions.map((v) => v.toFixed(2)).join(' × ') : '—'} |`);
  const shown = report.issues.filter((i) => i.severity !== 'info');
  if (shown.length) {
    lines.push('', '## Issues', '');
    for (const i of shown) lines.push(`- **${i.severity}** \`${i.id}\`: ${i.message}`);
  }
  lines.push('', '## Import', '');
  for (const hint of report.importHints) lines.push(`- ${hint}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {{name: string, profileId: string}} opts
 */
export async function exportScene({ name, profileId }) {
  const revision = sceneRevision(name);
  const { report } = await composeScene({ name, profileId });
  const errors = report.issues.filter((i) => i.severity === 'error');
  if (errors.length || !report.file) {
    return { name, profile: profileId, blocked: true, reason: errors.length ? `${errors.length} validation error(s)` : 'the scene is empty', errors, report };
  }
  // Preview = Export: an independent compose must reproduce the preview byte for byte.
  const previewBytes = fs.readFileSync(sceneGlb(name, profileId));
  const fresh = await composeScene({ name, profileId, write: false, force: true });
  const previewHash = sha256(previewBytes);
  const freshHash = fresh.glb ? sha256(fresh.glb) : null;
  if (previewHash !== freshHash) {
    return {
      name, profile: profileId, blocked: true, report,
      reason: 'a fresh compose does not reproduce the preview GLB (non-deterministic build)',
      errors: [{ id: 'export.nondeterministic', severity: 'error', message: `preview sha256 ${previewHash.slice(0, 12)} ≠ fresh compose ${String(freshHash).slice(0, 12)}` }],
    };
  }
  if (sceneRevision(name) !== revision || report.hashes.scene !== revision) {
    return { name, profile: profileId, blocked: true, reason: 'scene changed while exporting; build it again', errors: [], report };
  }
  const out = sceneExportPaths(name, profileId);
  ensureDir(path.dirname(out.glb));
  writeFileAtomic(out.glb, previewBytes);
  const exported = {
    ...report,
    file: { ...report.file, path: rel(out.glb), preview: report.file.path },
    export: { exportedAt: new Date().toISOString(), previewMatch: true, sha256: previewHash },
  };
  writeJson(out.json, exported);
  fs.writeFileSync(out.md, sceneReportMarkdown(exported));
  writeJson(out.layout, sceneLayout(name, readScene(name).scene, revision, report.items));
  return { name, profile: profileId, blocked: false, files: { glb: rel(out.glb), json: rel(out.json), md: rel(out.md), layout: rel(out.layout) }, report: exported };
}
