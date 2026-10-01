// node studio stats — project statistics and the PRD success metrics.

import fs from 'node:fs';
import path from 'node:path';
import { parse } from './args.js';
import { listAssets, listSets, loadSet } from '../core/targets.js';
import { loadAssetDef } from '../core/load-asset.js';
import { versionsForAsset } from '../core/history.js';
import { paths, previewReport } from '../core/paths.js';
import { readJson } from '../core/fsutil.js';
import { c, fmtNum } from '../core/log.js';

const USAGE = `Usage: node studio stats [--json]

Project statistics and the success metrics from the PRD:
  - time from the first prompt to the first GLB (target: under 5 minutes for simple assets)
  - share of the golden set that imports into Godot / Roblox Studio without manual fixes (≥ 90 %)
  - revision prompts per asset (tracked, no target)`;

function duration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

function median(values) {
  const v = values.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function readIf(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

export async function run(argv) {
  const { opts } = parse(argv, {}, USAGE);
  const metrics = readJson(paths.metrics, { assets: {} }).assets;
  const assets = [];
  let variantCount = 0;
  for (const slug of listAssets()) {
    let def = null;
    try {
      def = await loadAssetDef(slug);
    } catch {
      def = null;
    }
    const m = metrics[slug] || {};
    const versions = versionsForAsset(slug).filter((v) => !v.auto);
    const rep = readIf(previewReport(slug, null, 'generic'));
    const variants = def ? Object.keys(def.variants || {}).length : 0;
    variantCount += variants;
    const created = m.createdAt ? Date.parse(m.createdAt) : null;
    const firstGlb = m.firstGlbAt ? Date.parse(m.firstGlbAt) : null;
    const firstSave = m.firstSavedAt ? Date.parse(m.firstSavedAt) : versions[0] ? Date.parse(versions[0].createdAt) : null;
    const lastExport = Object.entries(m.exports || {}).sort((a, b) => b[1].at.localeCompare(a[1].at))[0] || null;
    assets.push({
      slug,
      title: def?.meta.title || slug,
      category: def?.meta.category || null,
      style: def?.meta.style || [],
      set: def?.meta.set || null,
      variants,
      triangles: rep?.triangles.total ?? null,
      errors: rep?.counts.error ?? null,
      builds: m.builds || 0,
      timeToFirstGlbMs: created && firstGlb ? firstGlb - created : null,
      timeToFirstSaveMs: created && firstSave ? firstSave - created : null,
      versions: versions.length,
      revisions: Math.max(0, versions.length - 1),
      lastExport: lastExport ? { profile: lastExport[0], at: lastExport[1].at, profiles: Object.keys(m.exports) } : null,
    });
  }
  const sets = listSets().map((name) => ({ name, members: loadSet(name).members.length }));
  const godot = readIf(path.join(paths.engines, 'godot', 'verify', 'report.json'));
  const golden = readIf(path.join(paths.golden, 'report', 'report.json'));
  const summary = {
    assets: assets.length,
    variants: variantCount,
    sets: sets.length,
    medianTimeToFirstGlbMs: median(assets.map((a) => a.timeToFirstGlbMs)),
    medianTimeToFirstSaveMs: median(assets.map((a) => a.timeToFirstSaveMs)),
    timedAssets: assets.filter((a) => a.timeToFirstGlbMs !== null).length,
    revisionsPerAsset: assets.filter((a) => a.versions).length ? +(assets.reduce((s, a) => s + a.revisions, 0) / assets.filter((a) => a.versions).length).toFixed(2) : null,
    godot: godot ? { passed: godot.passed, total: godot.total, rate: godot.total ? +(godot.passed / godot.total).toFixed(3) : null, godotVersion: godot.godotVersion, at: godot.finishedAt } : null,
    golden: golden ? { passed: golden.summary.passed, total: golden.summary.total, at: golden.finishedAt } : null,
  };
  if (opts.json) {
    console.log(JSON.stringify({ summary, assets, sets }, null, 2));
    return 0;
  }
  console.log(c.bold('AI 3D Asset Studio — project stats'));
  console.log(`  ${summary.assets} assets · ${summary.variants} variants · ${summary.sets} set(s)${sets.length ? ` (${sets.map((s) => `${s.name}: ${s.members}`).join(', ')})` : ''}\n`);
  const w = Math.max(...assets.map((a) => a.slug.length), 5);
  console.log(c.gray(`  ${'asset'.padEnd(w)}  ${'tris'.padStart(7)}  ${'first GLB'.padStart(9)}  ${'1st save'.padStart(9)}  ${'versions'.padStart(8)}  last export`));
  for (const a of assets) {
    const exp = a.lastExport ? `${a.lastExport.profiles.join('+')} ${a.lastExport.at.slice(0, 10)}` : c.gray('—');
    const err = a.errors ? c.red(` ${a.errors} err`) : '';
    console.log(`  ${a.slug.padEnd(w)}  ${(a.triangles === null ? '—' : fmtNum(a.triangles)).padStart(7)}  ${duration(a.timeToFirstGlbMs).padStart(9)}  ${duration(a.timeToFirstSaveMs).padStart(9)}  ${String(a.versions || '—').padStart(8)}  ${exp}${err}`);
  }
  console.log(`\n${c.bold('Success metrics')}`);
  const ttfg = summary.medianTimeToFirstGlbMs;
  console.log(`  time to first GLB (median of ${summary.timedAssets} timed asset(s)): ${duration(ttfg)}${ttfg !== null ? (ttfg < 5 * 60000 ? c.green('  ✓ under 5 min') : c.yellow('  over the 5 min target')) : c.gray('  (assets created with "node studio new" are timed)')}`);
  console.log(`  time to first saved version (median): ${duration(summary.medianTimeToFirstSaveMs)}`);
  if (summary.godot) console.log(`  Godot import without manual fixes: ${summary.godot.passed}/${summary.godot.total} (${(summary.godot.rate * 100).toFixed(0)}%, Godot ${summary.godot.godotVersion}, ${summary.godot.at?.slice(0, 10)})${summary.godot.rate >= 0.9 ? c.green('  ✓ ≥ 90%') : c.yellow('  below 90%')}`);
  else console.log(`  Godot import without manual fixes: ${c.gray('not measured — node studio engine-verify godot')}`);
  console.log(`  Roblox import without manual fixes: ${c.gray('measured in Roblox Studio — engines/roblox/CHECKLIST.md')}`);
  console.log(`  revision prompts per saved asset: ${summary.revisionsPerAsset ?? '—'}`);
  if (summary.golden) console.log(`  golden suite: ${summary.golden.passed}/${summary.golden.total} passed (${summary.golden.at?.slice(0, 10)})`);
  return 0;
}
