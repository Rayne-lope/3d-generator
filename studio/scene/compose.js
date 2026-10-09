// Compose a scene GLB: the preview GLB of every placed asset (exactly the bytes `export`
// would write for it) plus the room shell, merged into one file with one node per instance.
// Instances of the same asset share its meshes, materials and textures.

import fs from 'node:fs';
import { Document, PropertyType } from '@gltf-transform/core';
import { mergeDocuments, unpartition, dedup, prune } from '@gltf-transform/functions';
import { createIO } from '../core/ir/to-gltf.js';
import { inspectGLB } from '../core/inspect.js';
import { runKhronos } from '../core/validate/index.js';
import { sortIssues, countIssues } from '../core/validate/issues.js';
import { buildItem, describeError } from '../core/build.js';
import { loadAssetDef } from '../core/load-asset.js';
import { assetFile, itemId, rel } from '../core/paths.js';
import { hashDirs, readJson, sha256, writeFileAtomic, writeJson } from '../core/fsutil.js';
import { loadProfile } from '../profiles/index.js';
import { hasSetup } from '../core/setup.js';
import { STUD } from '../viewport/snap.js';
import { readScene } from './schema.js';
import { buildShell } from './shell.js';
import { checkSceneLayout } from './validate.js';
import { sceneGlb, sceneReport, scenePaths } from './paths.js';

const IDENTITY = { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] };
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

function isIdentity(node) {
  return near(node.getTranslation(), IDENTITY.t) && near(node.getRotation(), IDENTITY.r) && near(node.getScale(), IDENTITY.s);
}

/** Copy a node tree; the copies point at the same meshes (glTF instancing). */
function cloneTree(doc, node, name = node.getName()) {
  const copy = doc.createNode(name).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
  if (node.getMesh()) copy.setMesh(node.getMesh());
  const extras = node.getExtras();
  if (extras && Object.keys(extras).length) copy.setExtras(structuredClone(extras));
  for (const child of node.listChildren()) copy.addChild(cloneTree(doc, child));
  return copy;
}

function disposeTree(node) {
  for (const child of node.listChildren()) disposeTree(child);
  node.dispose();
}

export function yawQuaternion(deg) {
  const half = (deg * Math.PI) / 360;
  const s = Math.sin(half);
  return [0, Math.abs(s) < 1e-12 ? 0 : s, 0, Math.cos(half)];
}

/** Resolve and build every distinct item a scene places. */
async function buildMembers(scene, profileId, perMeter) {
  const members = new Map();
  for (const inst of scene.instances) {
    const id = itemId(inst.asset, inst.variant, inst.skin);
    if (members.has(id)) {
      members.get(id).count++;
      continue;
    }
    const member = { id, slug: inst.asset, variant: inst.variant, skin: inst.skin, count: 1 };
    members.set(id, member);
    if (!fs.existsSync(assetFile(inst.asset))) {
      member.missing = 'asset';
      continue;
    }
    try {
      const def = await loadAssetDef(inst.asset);
      member.title = def.meta.title;
      if (inst.variant && !Object.hasOwn(def.variants, inst.variant)) member.missing = 'variant';
      else if (inst.skin && !Object.hasOwn(def.skins || {}, inst.skin)) member.missing = 'skin';
      if (member.missing) continue;
      const { glb, report } = await buildItem({ slug: inst.asset, variant: inst.variant, skin: inst.skin, profileId });
      member.glb = glb;
      member.report = report;
      member.bounds = { min: report.bounds.min.map((v) => v / perMeter), max: report.bounds.max.map((v) => v / perMeter) };
    } catch (err) {
      member.error = describeError(err, inst.asset);
    }
  }
  return members;
}

/** Merge a GLB into `target` and return its top-level nodes (still attached to their own scene). */
async function addPrototype(io, target, glb) {
  const source = await io.readBinary(glb);
  const sourceScene = source.getRoot().getDefaultScene() || source.getRoot().listScenes()[0];
  const map = mergeDocuments(target, source);
  const scene = map.get(sourceScene);
  return { scene, roots: scene.listChildren() };
}

/**
 * @param {{name: string, profileId?: string, write?: boolean, force?: boolean}} opts
 * @returns {Promise<{glb: Uint8Array|null, report: any, cached: boolean}>}
 */
export async function composeScene({ name, profileId = 'generic', write = true, force = false }) {
  const t0 = performance.now();
  const profile = loadProfile(profileId);
  const perMeter = profile.units.perMeter;
  const { scene, revision } = readScene(name);
  const members = await buildMembers(scene, profileId, perMeter);
  const usable = [...members.values()].filter((m) => m.glb);
  const shell = scene.room ? await buildShell({ name, room: scene.room, title: scene.title, profileId, write, force }) : null;

  const composeHash = sha256(JSON.stringify({ revision, profileId, code: hashDirs([scenePaths.code]), shell: shell?.info.sha256 || null, members: [...members.values()].map((m) => [m.id, m.report?.hashes.glb || m.missing || 'error']) }));
  const glbFile = sceneGlb(name, profileId);
  const reportFile = sceneReport(name, profileId);
  if (!force && write && fs.existsSync(glbFile) && fs.existsSync(reportFile)) {
    const prev = readJson(reportFile, null);
    if (prev && prev.hashes?.compose === composeHash) return { glb: new Uint8Array(fs.readFileSync(glbFile)), report: prev, cached: true };
  }

  const io = createIO();
  const doc = new Document();
  const prototypes = new Map();
  for (const member of usable) prototypes.set(member.id, await addPrototype(io, doc, member.glb));
  const shellProto = shell ? await addPrototype(io, doc, shell.glb) : null;
  doc.getRoot().getAsset().generator = 'AI 3D Asset Studio';
  doc.getRoot().getAsset().extras = {
    studio: { scene: name, title: scene.title, profile: profileId, units: { name: profile.units.name, metersPerUnit: 1 / perMeter, perMeter }, sceneRevision: revision },
  };

  const out = doc.createScene(name);
  if (shellProto) {
    const room = doc.createNode('room').setExtras({ studio: { role: 'room' } });
    // The shell's own root is an empty holder: lift its surfaces straight under 'room'.
    for (const root of shellProto.roots) {
      if (!root.getMesh() && isIdentity(root)) for (const child of root.listChildren()) room.addChild(cloneTree(doc, child));
      else room.addChild(cloneTree(doc, root));
    }
    out.addChild(room);
  }
  // Grouped instances go under one node per group, so the unit survives into the engine.
  const groupNodes = new Map();
  const parentOf = (inst) => {
    if (!inst.group) return out;
    if (!groupNodes.has(inst.group)) {
      const node = doc.createNode(inst.group).setExtras({ studio: { role: 'group', group: inst.group } });
      out.addChild(node);
      groupNodes.set(inst.group, node);
    }
    return groupNodes.get(inst.group);
  };
  for (const inst of scene.instances) {
    const proto = prototypes.get(itemId(inst.asset, inst.variant, inst.skin));
    if (!proto) continue;
    const translation = inst.position.map((v) => v * perMeter);
    const rotation = yawQuaternion(inst.yaw);
    const extras = { studio: { role: 'instance', instance: inst.id, asset: inst.asset, ...(inst.variant ? { variant: inst.variant } : {}), ...(inst.skin ? { skin: inst.skin } : {}) } };
    let holder;
    if (proto.roots.length === 1 && !proto.roots[0].getMesh() && isIdentity(proto.roots[0])) {
      // The asset root becomes the instance node (no extra nesting level in the engine).
      holder = cloneTree(doc, proto.roots[0], inst.id);
    } else {
      holder = doc.createNode(inst.id);
      for (const root of proto.roots) holder.addChild(cloneTree(doc, root));
    }
    holder.setTranslation(translation).setRotation(rotation).setExtras(extras);
    parentOf(inst).addChild(holder);
  }
  for (const proto of [...prototypes.values(), ...(shellProto ? [shellProto] : [])]) {
    for (const root of proto.roots) disposeTree(root);
    proto.scene.dispose();
  }
  doc.getRoot().setDefaultScene(out);
  await doc.transform(
    unpartition(),
    dedup({ propertyTypes: [PropertyType.TEXTURE] }),
    prune({ keepLeaves: true, keepAttributes: true, keepExtras: true, keepSolidTextures: true }),
  );

  const empty = !out.listChildren().length;
  const glb = empty ? null : await io.writeBinary(doc);
  const info = glb ? await inspectGLB(glb) : null;
  const khronos = glb ? await runKhronos(glb) : { issues: [], summary: null };
  const issues = sortIssues([
    ...checkSceneLayout({ scene, members, profile, info }),
    ...khronos.issues,
    ...(shell ? shell.info.issues.filter((i) => i.severity !== 'info').map((i) => ({ ...i, where: i.where ? `room/${i.where}` : 'room' })) : []),
  ]);
  const counts = countIssues(issues);
  const sizeUnits = info ? info.bbox.size.map((v) => +v.toFixed(4)) : [0, 0, 0];
  const sizeM = sizeUnits.map((v) => +(v / perMeter).toFixed(4));
  const report = {
    schema: 1,
    kind: 'scene',
    name,
    title: scene.title,
    prompt: scene.prompt,
    interpretation: scene.interpretation,
    profile: { id: profile.id, label: profile.label, units: { name: profile.units.name, perMeter } },
    ok: counts.error === 0 && !!glb,
    counts,
    file: glb ? { path: rel(glbFile), bytes: glb.byteLength, sha256: sha256(glb) } : null,
    dimensions: { meters: sizeM, units: sizeUnits, unitName: profile.units.name, studs: sizeM.map((v) => +(v / STUD).toFixed(2)) },
    bounds: info ? { min: info.bbox.min.map((v) => +v.toFixed(5)), max: info.bbox.max.map((v) => +v.toFixed(5)) } : null,
    triangles: { total: info?.triangles || 0, room: shell?.info.triangles || 0 },
    meshCount: info?.meshes.length || 0,
    instanceCount: scene.instances.length,
    room: scene.room,
    items: [...members.values()].map((m) => ({
      item: m.id, slug: m.slug, variant: m.variant, skin: m.skin, title: m.title || m.slug, count: m.count,
      triangles: m.report?.triangles.total ?? null, meshes: m.report?.meshCount ?? null,
      dimensions: m.report?.dimensions.meters ?? null,
      ok: !!m.report && m.report.counts.error === 0, errors: m.report?.counts.error ?? null, warnings: m.report?.counts.warning ?? null,
      problem: m.missing ? `missing ${m.missing}` : m.error || null,
      // Attachments and collision of the item, relative to its own origin (file units).
      ...(m.report && hasSetup(m.report) ? { setup: { collision: m.report.collision, attachments: m.report.attachments, colliders: m.report.colliders } } : {}),
    })),
    instances: scene.instances.map((inst) => ({ id: inst.id, item: itemId(inst.asset, inst.variant, inst.skin), position: inst.position, yaw: inst.yaw, ...(inst.group ? { group: inst.group } : {}) })),
    issues,
    khronos: khronos.summary,
    hashes: { scene: revision, compose: composeHash, glb: glb ? sha256(glb) : null },
    timing: { buildMs: Math.round(performance.now() - t0) },
    builtAt: new Date().toISOString(),
    importHints: [
      ...profile.importHints,
      'This file is a whole scene: every placed asset is its own group (named by its instance id), so you can still move, script or replace them one by one in the engine.',
    ],
  };
  if (write) {
    if (glb) writeFileAtomic(glbFile, glb);
    else fs.rmSync(glbFile, { force: true });
    writeJson(reportFile, report);
  }
  return { glb, report, cached: false };
}

/** One-screen summary of a scene report for the terminal. */
export function formatSceneReport(report, { verbose = false } = {}) {
  const lines = [];
  const status = report.ok ? 'OK' : 'BLOCKED';
  lines.push(`${status} scene ${report.name} [${report.profile.id}] ${(report.timing.buildMs / 1000).toFixed(1)} s`);
  lines.push(`  ${report.dimensions.meters.map((v) => v.toFixed(2)).join(' × ')} m · ${report.triangles.total.toLocaleString('en-US')} tris · ${report.meshCount} meshes · ${report.instanceCount} instances of ${report.items.length} assets${report.file ? ` · ${(report.file.bytes / 1024).toFixed(1)} KB` : ''}`);
  for (const i of report.issues) {
    if (i.severity === 'info' && !verbose) continue;
    lines.push(`  ${i.severity.toUpperCase().padEnd(7)} ${i.id}: ${i.message}${verbose && i.hint ? `\n          fix: ${i.hint}` : ''}`);
  }
  const hidden = report.issues.filter((i) => i.severity === 'info').length;
  if (hidden && !verbose) lines.push(`  ${hidden} info message(s) hidden (use --verbose)`);
  if (report.file) lines.push(`  -> ${report.file.path}`);
  return lines.join('\n');
}
