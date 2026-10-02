// Golden suite: every golden item (asset + variants) in every profile must pass
//   validate     0 errors, only allowed warnings
//   determinism  a fresh build reproduces the preview GLB byte for byte (Preview = Export)
//   structure    triangles / meshes / materials / textures / size match golden/manifest.json
//   regression   renders match the committed baselines (golden/baselines/<profile>/<item>.png)
//   parity       source scene vs exported GLB from identical cameras
// The manifest is also what the Godot and Roblox engine checks compare against.

import fs from 'node:fs';
import path from 'node:path';
import { buildItem, describeError } from './build.js';
import { parityCheck } from './review.js';
import { loadAssetDef } from './load-asset.js';
import { loadConfig } from './config.js';
import { paths, itemId, previewGlb, rel } from './paths.js';
import { ensureDir, readJson, sha256, writeJson } from './fsutil.js';
import { dataUrlToBuffer, readPNG, writePNG, diffImages, grid } from './render/image.js';
import { KIT_VERSION } from '../kit/index.js';

export const goldenFile = () => path.join(paths.golden, 'golden.json');
export const manifestFile = () => path.join(paths.golden, 'manifest.json');
const baselineFile = (profileId, id) => path.join(paths.golden, 'baselines', profileId, `${id}.png`);

export function loadGolden() {
  return readJson(goldenFile());
}

/** Expand golden.json entries into build items (base + variants + skins of the base). */
export async function goldenItems(golden, { only = null, variants = true } = {}) {
  const items = [];
  for (const entry of golden.items) {
    if (only && !only.includes(entry.slug)) continue;
    items.push({ slug: entry.slug, variant: null, skin: null, entry });
    if (entry.skins) {
      const def = await loadAssetDef(entry.slug);
      const list = Array.isArray(entry.skins) ? entry.skins : Object.keys(def.skins || {});
      for (const s of list) items.push({ slug: entry.slug, variant: null, skin: s, entry });
    }
    if (!variants || entry.variants === 'none') continue;
    const def = await loadAssetDef(entry.slug);
    const list = Array.isArray(entry.variants) ? entry.variants : Object.keys(def.variants || {});
    for (const v of list) items.push({ slug: entry.slug, variant: v, skin: null, entry });
  }
  if (only) {
    const missing = only.filter((s) => !golden.items.some((e) => e.slug === s));
    if (missing.length) throw new Error(`not in golden/golden.json: ${missing.join(', ')}`);
  }
  return items;
}

/** Structural fingerprint of a build report (stored in the manifest, verified in engines). */
export function fingerprint(report) {
  return {
    title: report.title,
    triangles: report.triangles.total,
    meshes: report.meshCount,
    meshNodes: report.triangles.perMesh.map((m) => ({ node: m.node, triangles: m.triangles, materials: m.materials })),
    nodes: report.nodes.filter((n) => n.hasMesh).map((n) => ({ name: n.name, translation: n.translation })),
    materials: report.materials.map((m) => ({ name: m.name, baseColor: m.baseColor, alpha: m.alpha, metallic: m.metallic, roughness: m.roughness, alphaMode: m.alphaMode, emissive: m.emissive, maps: Object.keys(m.maps) })),
    textures: report.textures.map((t) => ({ name: t.name, width: t.width, height: t.height })),
    sizeMeters: report.dimensions.meters,
    sizeUnits: report.dimensions.units,
    unitName: report.dimensions.unitName,
    boundsMin: report.bounds.min,
    sha256: report.file.sha256,
  };
}

export function compareFingerprint(expected, actual) {
  const problems = [];
  if (expected.triangles !== actual.triangles) problems.push(`triangles ${expected.triangles} → ${actual.triangles}`);
  if (expected.meshes !== actual.meshes) problems.push(`meshes ${expected.meshes} → ${actual.meshes}`);
  const names = (list) => list.map((m) => m.name).join(',');
  if (names(expected.materials) !== names(actual.materials)) problems.push(`materials ${names(expected.materials)} → ${names(actual.materials)}`);
  else {
    expected.materials.forEach((m, i) => {
      const a = actual.materials[i];
      if (m.baseColor !== a.baseColor || m.alphaMode !== a.alphaMode || Math.abs(m.metallic - a.metallic) > 0.005 || Math.abs(m.roughness - a.roughness) > 0.005) problems.push(`material ${m.name} changed`);
    });
  }
  const tex = (list) => list.map((t) => `${t.name} ${t.width}x${t.height}`).join(',');
  if (tex(expected.textures) !== tex(actual.textures)) problems.push(`textures ${tex(expected.textures) || '-'} → ${tex(actual.textures) || '-'}`);
  if (expected.sizeMeters.some((v, i) => Math.abs(v - actual.sizeMeters[i]) > 0.001)) problems.push(`size ${expected.sizeMeters.join('×')} → ${actual.sizeMeters.join('×')} m`);
  return problems;
}

/**
 * Run the suite. Requires an open capture api.
 * @param {{profiles: string[], update?: boolean, only?: string[]|null, onResult?: (row: any) => void}} opts
 */
export async function runGolden(api, { profiles, update = false, only = null, onResult = () => {} }) {
  const config = loadConfig();
  const golden = loadGolden();
  const items = await goldenItems(golden, { only });
  const manifest = readJson(manifestFile(), { schema: 1, items: {} });
  const reportDir = path.join(paths.golden, 'report');
  fs.rmSync(path.join(reportDir, 'img'), { recursive: true, force: true });
  ensureDir(reportDir);
  const startedAt = new Date().toISOString();
  const rows = [];
  for (const profileId of profiles) {
    const allowed = new Set(golden.allowWarnings?.[profileId] || []);
    for (const it of items) {
      const id = itemId(it.slug, it.variant, it.skin);
      const key = `${profileId}/${id}`;
      const row = { id, slug: it.slug, variant: it.variant, skin: it.skin, profile: profileId, type: it.entry.type, style: it.entry.style, checks: {}, ok: true, problems: [] };
      const fail = (check, detail) => {
        row.checks[check] = { ok: false, detail };
        row.ok = false;
        row.problems.push(`${check}: ${detail}`);
      };
      const pass = (check, detail) => {
        row.checks[check] = { ok: true, detail };
      };
      try {
        const { report } = await buildItem({ slug: it.slug, variant: it.variant, skin: it.skin, profileId });
        row.triangles = report.triangles.total;
        row.sizeMeters = report.dimensions.meters;
        // validate
        const errs = report.issues.filter((i) => i.severity === 'error');
        const itemAllowed = new Set(it.entry.allowWarnings || []);
        const warns = report.issues.filter((i) => i.severity === 'warning' && i.id !== 'parity.mismatch' && !allowed.has(i.id) && !itemAllowed.has(i.id));
        if (errs.length) fail('validate', `${errs.length} error(s): ${[...new Set(errs.map((e) => e.id))].join(', ')}`);
        else if (warns.length) fail('validate', `unexpected warning(s): ${[...new Set(warns.map((w) => w.id))].join(', ')}`);
        else pass('validate', `0 errors${report.counts.warning ? `, ${report.counts.warning} allowed warning(s)` : ''}`);
        // determinism (Preview = Export)
        const fresh = await buildItem({ slug: it.slug, variant: it.variant, skin: it.skin, profileId, write: false, force: true });
        const previewHash = sha256(fs.readFileSync(previewGlb(it.slug, it.variant, profileId, it.skin)));
        const freshHash = sha256(fresh.glb);
        if (previewHash === freshHash) pass('determinism', freshHash.slice(0, 12));
        else fail('determinism', `preview ${previewHash.slice(0, 12)} ≠ fresh ${freshHash.slice(0, 12)}`);
        // structure
        const fp = fingerprint(report);
        if (update) {
          manifest.items[key] = fp;
          pass('structure', 'manifest updated');
        } else if (!manifest.items[key]) fail('structure', 'no manifest entry (run: node studio golden --update-baselines)');
        else {
          const problems = compareFingerprint(manifest.items[key], fp);
          if (problems.length) fail('structure', problems.join('; '));
          else pass('structure', `${fp.triangles} tris · ${fp.meshes} mesh · ${fp.materials.length} mat`);
        }
        // regression
        const shots = await api.renderGLB({ url: `${api.url}files/preview/${id}/${profileId}.glb`, views: golden.views, size: golden.tileSize });
        const current = grid(golden.views.map((v) => readPNG(dataUrlToBuffer(shots.images[v]))), 2);
        const curFile = path.join(reportDir, 'img', profileId, `${id}.png`);
        writePNG(curFile, current);
        row.images = { current: rel(curFile), baseline: rel(baselineFile(profileId, id)) };
        if (update) {
          writePNG(baselineFile(profileId, id), current);
          pass('regression', 'baseline updated');
        } else if (!fs.existsSync(baselineFile(profileId, id))) fail('regression', 'no baseline image (run: node studio golden --update-baselines)');
        else {
          const base = readPNG(baselineFile(profileId, id));
          if (base.width !== current.width || base.height !== current.height) fail('regression', `baseline is ${base.width}×${base.height}, render is ${current.width}×${current.height}`);
          else {
            const d = diffImages(base, current, { threshold: config.parity.pixelThreshold });
            const diffFile = path.join(reportDir, 'img', profileId, `${id}-diff.png`);
            writePNG(diffFile, d.diff);
            row.images.diff = rel(diffFile);
            row.regression = +d.ratio.toFixed(4);
            if (d.ratio <= config.golden.regressionMaxDiffRatio) pass('regression', `${(d.ratio * 100).toFixed(2)}%`);
            else fail('regression', `${(d.ratio * 100).toFixed(2)}% of object pixels changed (limit ${(config.golden.regressionMaxDiffRatio * 100).toFixed(1)}%)`);
          }
        }
        // parity
        const par = await parityCheck(api, { slug: it.slug, variant: it.variant, skin: it.skin, profileId, size: golden.paritySize });
        row.parity = par.max;
        if (par.ok) pass('parity', `${(par.max * 100).toFixed(2)}%`);
        else fail('parity', `${(par.max * 100).toFixed(2)}% (limit ${(par.threshold * 100).toFixed(1)}%)`);
      } catch (err) {
        fail('build', describeError(err, it.slug).split('\n')[0]);
      }
      rows.push(row);
      onResult(row);
    }
  }
  if (update) {
    // A full update also drops entries and baselines of items no longer in the golden set.
    const full = !only && golden.profiles.every((p) => profiles.includes(p));
    const keep = new Set(rows.map((r) => `${r.profile}/${r.id}`));
    const entries = Object.entries(manifest.items).filter(([k]) => !full || keep.has(k)).sort(([a], [b]) => a.localeCompare(b));
    writeJson(manifestFile(), { schema: 1, kit: KIT_VERSION, updatedAt: new Date().toISOString(), items: Object.fromEntries(entries) });
    if (full) {
      for (const profileId of profiles) {
        const dir = path.join(paths.golden, 'baselines', profileId);
        for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (!keep.has(`${profileId}/${f.replace(/\.png$/, '')}`)) fs.rmSync(path.join(dir, f));
      }
    }
  }
  const summary = {
    total: rows.length,
    passed: rows.filter((r) => r.ok).length,
    failed: rows.filter((r) => !r.ok).length,
    byProfile: Object.fromEntries(profiles.map((p) => [p, { total: rows.filter((r) => r.profile === p).length, passed: rows.filter((r) => r.profile === p && r.ok).length }])),
  };
  const result = { startedAt, finishedAt: new Date().toISOString(), kit: KIT_VERSION, updated: update, profiles, summary, rows };
  writeJson(path.join(reportDir, 'report.json'), result);
  fs.writeFileSync(path.join(reportDir, 'index.html'), reportHtml(result));
  return result;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function reportHtml(result) {
  const fromReport = (p) => (p ? path.relative('golden/report', p).split(path.sep).join('/') : '');
  const checks = ['validate', 'determinism', 'structure', 'regression', 'parity'];
  const sections = result.profiles.map((profileId) => {
    const rows = result.rows.filter((r) => r.profile === profileId);
    const body = rows.map((r) => `
      <tr class="${r.ok ? 'ok' : 'fail'}">
        <td><b>${esc(r.id)}</b><div class="muted">${esc(r.type)} · ${esc(r.style)}</div>${r.problems.length ? `<div class="problems">${r.problems.map(esc).join('<br>')}</div>` : ''}</td>
        ${checks.map((c) => {
          const x = r.checks[c] || r.checks.build;
          return `<td class="${x ? (x.ok ? 'pass' : 'bad') : ''}" title="${esc(x?.detail)}">${x ? (x.ok ? '✓' : '✗') : '–'}<div class="muted">${esc(x?.detail || '')}</div></td>`;
        }).join('')}
        <td class="imgs">${r.images ? `<img src="${fromReport(r.images.baseline)}" alt="baseline" loading="lazy"><img src="${fromReport(r.images.current)}" alt="current" loading="lazy">${r.images.diff ? `<img src="${fromReport(r.images.diff)}" alt="diff" loading="lazy">` : ''}` : ''}</td>
      </tr>`).join('');
    const s = result.summary.byProfile[profileId];
    return `<h2>${esc(profileId)} — ${s.passed}/${s.total} passed</h2>
    <table><thead><tr><th>Item</th>${checks.map((c) => `<th>${c}</th>`).join('')}<th>baseline · current · diff</th></tr></thead><tbody>${body}</tbody></table>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Golden Report</title>
<style>
:root { --bg: #16181c; --panel: #1f2329; --text: #e6e9ee; --muted: #8b93a1; --ok: #4cc38a; --bad: #ff5d73; }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text); font: 14px/1.4 system-ui, sans-serif; }
h1 { margin: 0 0 4px; } h2 { margin-top: 32px; }
.muted { color: var(--muted); font-size: 12px; }
table { width: 100%; border-collapse: collapse; background: var(--panel); }
th, td { padding: 8px; border-bottom: 1px solid #2c313a; vertical-align: top; text-align: left; }
td.pass { color: var(--ok); } td.bad { color: var(--bad); }
tr.fail td:first-child { border-left: 3px solid var(--bad); } tr.ok td:first-child { border-left: 3px solid var(--ok); }
.problems { color: var(--bad); font-size: 12px; margin-top: 4px; }
.imgs img { width: 128px; height: 128px; margin-right: 4px; background: #000; border-radius: 4px; }
.wrap { overflow-x: auto; }
</style></head><body>
<h1>Golden report</h1>
<div class="muted">${esc(result.finishedAt)} · kit ${esc(result.kit)} · ${result.summary.passed}/${result.summary.total} passed${result.updated ? ' · baselines updated' : ''}</div>
<div class="wrap">${sections}</div>
</body></html>
`;
}
