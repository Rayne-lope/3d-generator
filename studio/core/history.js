// Version history: snapshots of an asset (or a whole set) after each generate/revise step.
// Stored in .studio/history/<target>/vNNN/{source/, *.glb, meta.json, sheet.png, thumb.png}.
//
// index.json keeps the version list plus `head`: the version the working copy was last saved
// as or restored from. Every version records its `parent` (the head when it was saved), so
// undo walks back along the edits the user actually made, even after reverts.
// Keeps the last `history.keep` unpinned versions plus every pinned version and the head.

import fs from 'node:fs';
import path from 'node:path';
import { paths, assetDir, previewGlb, previewReport, rel } from './paths.js';
import { copyDir, ensureDir, hashDirs, listFiles, readJson, removeDir, writeJson } from './fsutil.js';
import { loadConfig } from './config.js';
import { loadSet, setOfAsset } from './targets.js';
import { loadAssetDef } from './load-asset.js';
import { editorControls } from '../kit/editor.js';

/** Normalize 'set:<name>' or '<slug>' into a target descriptor. */
export function parseTarget(target) {
  if (typeof target === 'object') return target;
  if (target.startsWith('set:')) {
    const name = target.slice(4);
    const set = loadSet(name);
    return { kind: 'set', name, key: `set-${name}`, members: set.members, label: `set:${name}` };
  }
  if (!fs.existsSync(path.join(assetDir(target), 'asset.js'))) throw new Error(`unknown asset '${target}'`);
  return { kind: 'asset', name: target, key: target, members: [target], label: target };
}

export function historyDir(target) {
  const key = typeof target === 'string' ? (target.startsWith('set:') ? `set-${target.slice(4)}` : target) : target.key;
  return path.join(paths.history, key);
}

function indexFile(target) {
  return path.join(historyDir(target), 'index.json');
}

function readIndex(target) {
  const file = indexFile(target);
  if (!fs.existsSync(file)) return { versions: [], head: null };
  const data = readJson(file, { versions: [] });
  return { versions: data.versions || [], head: data.head || null };
}

function writeIndex(t, versions, head) {
  writeJson(indexFile(t), { target: t.label, head, versions });
}

export function listVersions(target) {
  return readIndex(target).versions;
}

function sourceDirs(t) {
  if (t.kind === 'set') return [path.join(paths.sets, t.name), ...t.members.map((m) => assetDir(m))];
  return [assetDir(t.name)];
}

/** Content hash of the working copy (asset folder, or set folder + members). */
export function workingHash(target) {
  const t = parseTarget(target);
  return hashDirs(sourceDirs(t), t.label);
}

function nextId(versions, t) {
  // Never reuse an id, even after pruning: look at the folders too.
  const dirs = fs.existsSync(historyDir(t)) ? fs.readdirSync(historyDir(t)).filter((d) => /^v\d+$/.test(d)) : [];
  const n = [...versions.map((v) => v.id), ...dirs].reduce((m, id) => Math.max(m, Number(id.slice(1))), 0) + 1;
  return `v${String(n).padStart(3, '0')}`;
}

/**
 * Where the working copy stands: the version it equals (if any) and whether it has unsaved
 * changes relative to the head.
 */
export function workingState(target) {
  const t = parseTarget(target);
  const { versions, head } = readIndex(t);
  const hash = workingHash(t);
  const headV = versions.find((v) => v.id === head) || versions[versions.length - 1] || null;
  let current = headV && headV.sourceHash === hash ? headV : null;
  if (!current) current = [...versions].reverse().find((v) => v.sourceHash === hash) || null;
  return { versions, head: headV, current, dirty: !current, hash };
}

/**
 * Save a version. `build` is an async function (slug) => report used to (re)build the generic
 * preview; `thumbnail` is an optional async function (versionDir, t) that writes sheet.png and
 * thumb.png. Skips when nothing changed since the head (unless `force`).
 */
export async function saveVersion(target, { note = '', pin = false, force = false, build, thumbnail = null, auto = false, keep, includeVariants = false, preferredVariant = null } = {}) {
  const t = parseTarget(target);
  const { versions, head } = readIndex(t);
  const hash = workingHash(t);
  const headV = versions.find((v) => v.id === head) || versions[versions.length - 1];
  if (headV && headV.sourceHash === hash && !force) {
    return { skipped: true, version: headV, reason: `no changes since ${headV.id}` };
  }
  const id = nextId(versions, t);
  const dir = path.join(historyDir(t), id);
  ensureDir(dir);
  // Source snapshot.
  if (t.kind === 'set') {
    copyDir(path.join(paths.sets, t.name), path.join(dir, 'source', 'set'));
    for (const m of t.members) copyDir(assetDir(m), path.join(dir, 'source', 'assets', m));
  } else {
    copyDir(assetDir(t.name), path.join(dir, 'source', 'asset'));
  }
  // GLB snapshot(s) + stats from the generic profile.
  const stats = {};
  const lookGlbs = {};
  const lookStats = {};
  try {
    for (const m of t.members) {
      const report = await build(m, null);
      const glb = previewGlb(m, null, 'generic');
      fs.copyFileSync(glb, path.join(dir, t.kind === 'set' ? `${m}.glb` : 'generic.glb'));
      if (t.kind === 'asset' && fs.existsSync(previewReport(m, null, 'generic'))) fs.copyFileSync(previewReport(m, null, 'generic'), path.join(dir, 'generic.report.json'));
      stats[m] = {
        triangles: report.triangles.total,
        dimensions: report.dimensions.meters,
        materials: report.materials.length,
        meshes: report.meshCount,
        errors: report.counts.error,
        warnings: report.counts.warning,
      };
      if (includeVariants && t.kind === 'asset') {
        const def = await loadAssetDef(m);
        for (const variant of Object.keys(def.variants || {})) {
          const variantReport = await build(m, variant);
          const filename = `generic--${variant}.glb`;
          fs.copyFileSync(previewGlb(m, variant, 'generic'), path.join(dir, filename));
          if (fs.existsSync(previewReport(m, variant, 'generic'))) fs.copyFileSync(previewReport(m, variant, 'generic'), path.join(dir, `generic--${variant}.report.json`));
          lookGlbs[variant] = filename;
          lookStats[variant] = { triangles: variantReport.triangles.total, dimensions: variantReport.dimensions.meters, materials: variantReport.materials.length, meshes: variantReport.meshCount, errors: variantReport.counts.error, warnings: variantReport.counts.warning };
        }
      }
    }
    if (workingHash(t) !== hash) throw new Error(`source changed while saving ${t.label}; retry`);
  } catch (err) {
    removeDir(dir);
    throw err;
  }
  const setName = t.kind === 'asset' ? setOfAsset(t.name) : null;
  const meta = {
    id,
    createdAt: new Date().toISOString(),
    note,
    pinned: !!pin,
    auto: !!auto,
    kind: t.kind,
    parent: headV ? headV.id : null,
    sourceHash: hash,
    setHash: setName ? hashDirs([path.join(paths.sets, setName)]) : null,
    triangles: Object.values(stats).reduce((s, x) => s + x.triangles, 0),
    stats,
    ...(Object.keys(lookGlbs).length ? { lookGlbs } : {}),
    ...(Object.keys(lookStats).length ? { lookStats } : {}),
    ...(preferredVariant && lookGlbs[preferredVariant] ? { preferredVariant } : {}),
  };
  writeJson(path.join(dir, 'meta.json'), meta);
  if (thumbnail) {
    try {
      await thumbnail(dir, t, meta);
    } catch {
      // thumbnails are optional (no browser available)
    }
  }
  if (workingHash(t) !== hash) {
    removeDir(dir);
    throw new Error(`source changed while saving ${t.label}; retry`);
  }
  versions.push(meta);
  const pruned = prune(t, versions, id, keep);
  writeIndex(t, pruned.kept, id);
  return { skipped: false, version: meta, pruned: pruned.removed, dir: rel(dir) };
}

function prune(t, versions, head, keep = loadConfig().history.keep) {
  const unpinned = versions.filter((v) => !v.pinned && v.id !== head);
  const removeCount = Math.max(0, unpinned.length - Math.max(0, keep - 1));
  const remove = new Set(unpinned.slice(0, removeCount).map((v) => v.id));
  for (const id of remove) removeDir(path.join(historyDir(t), id));
  return { kept: versions.filter((v) => !remove.has(v.id)), removed: [...remove] };
}

export function getVersion(target, id) {
  const versions = listVersions(target);
  const want = /^v?\d+$/.test(String(id)) ? `v${String(String(id).replace(/^v/, '')).padStart(3, '0')}` : String(id);
  const v = versions.find((x) => x.id === want);
  if (!v) throw new Error(`version '${id}' not found (have: ${versions.map((x) => x.id).join(', ') || 'none'})`);
  return v;
}

function restoreDir(snapshot, dest) {
  ensureDir(dest);
  const keep = new Set(listFiles(snapshot));
  for (const f of listFiles(dest)) if (!keep.has(f)) fs.rmSync(path.join(dest, f));
  copyDir(snapshot, dest);
}

/** Restore a version into the working copy. Unsaved changes are auto-saved first. */
export async function revertVersion(target, id, { build, thumbnail = null } = {}) {
  const t = parseTarget(target);
  const v = getVersion(t, id);
  let autosaved = null;
  if (workingState(t).dirty) {
    const { editorParts } = await import('../kit/editor.js');
    const assetDef = t.kind === 'asset' ? await loadAssetDef(t.name) : null;
    const includeVariants = !!assetDef && (editorControls(assetDef).length > 0 || editorParts(assetDef).length > 0);
    const res = await saveVersion(t, { note: `auto-save before restoring ${v.id}`, auto: true, build, thumbnail, includeVariants });
    if (!res.skipped) autosaved = res.version.id;
  }
  const dir = path.join(historyDir(t), v.id, 'source');
  if (t.kind === 'set') {
    restoreDir(path.join(dir, 'set'), path.join(paths.sets, t.name));
    for (const m of t.members) if (fs.existsSync(path.join(dir, 'assets', m))) restoreDir(path.join(dir, 'assets', m), assetDir(m));
  } else {
    restoreDir(path.join(dir, 'asset'), assetDir(t.name));
  }
  const { versions } = readIndex(t);
  writeIndex(t, versions, v.id);
  return { restored: v.id, autosaved, version: v };
}

/**
 * Undo the last step: with unsaved changes, go back to the head (the changes are auto-saved
 * first, so nothing is lost); otherwise go back to the parent of the current version.
 */
export async function undo(target, opts = {}) {
  const t = parseTarget(target);
  const state = workingState(t);
  if (!state.versions.length) throw new Error(`no saved versions for ${t.label}`);
  let to;
  if (state.dirty) {
    to = state.head;
  } else {
    const cur = state.current;
    to = state.versions.find((v) => v.id === cur.parent);
    if (!to) {
      // Parent pruned or never recorded: fall back to the version saved just before it.
      const idx = state.versions.findIndex((v) => v.id === cur.id);
      to = idx > 0 ? state.versions[idx - 1] : null;
    }
    if (!to) throw new Error(`${t.label} is at its first saved version (${cur.id}); nothing to undo`);
  }
  return revertVersion(t, to.id, opts);
}

export function setPinned(target, id, pinned) {
  const t = parseTarget(target);
  const { versions, head } = readIndex(t);
  const v = getVersion(t, id);
  const metaFile = path.join(historyDir(t), v.id, 'meta.json');
  const meta = readJson(metaFile, v);
  meta.pinned = pinned;
  writeJson(metaFile, meta);
  writeIndex(t, versions.map((x) => (x.id === v.id ? { ...x, pinned } : x)), head);
  return { ...v, pinned };
}

/** Path of a version's source snapshot for one asset. */
export function versionAssetSource(target, id, slug) {
  const t = parseTarget(target);
  const v = getVersion(t, id);
  return t.kind === 'set' ? path.join(historyDir(t), v.id, 'source', 'assets', slug) : path.join(historyDir(t), v.id, 'source', 'asset');
}

/** Path of a version's set source snapshot (sets only). */
export function versionSetSource(target, id) {
  const t = parseTarget(target);
  const v = getVersion(t, id);
  return path.join(historyDir(t), v.id, 'source', 'set');
}

export function versionGlb(target, id, slug, variant = null) {
  const t = parseTarget(target);
  const v = getVersion(t, id);
  if (variant && t.kind === 'asset') {
    if (!v.lookGlbs?.[variant]) throw new Error(`version '${v.id}' has no preview for variant '${variant}'`);
    return path.join(historyDir(t), v.id, v.lookGlbs[variant]);
  }
  return path.join(historyDir(t), v.id, t.kind === 'set' ? `${slug}.glb` : 'generic.glb');
}

/**
 * Versions that contain an asset: its own saves plus saves of its set. Paths are relative to
 * .studio/history (served at /files/history/ by the dev server).
 */
export function versionsForAsset(slug, variant = null) {
  const own = listVersions(slug).map((v) => {
    const glbName = variant ? v.lookGlbs?.[variant] || null : 'generic.glb';
    const reportName = variant ? `generic--${variant}.report.json` : 'generic.report.json';
    const thumbName = variant ? `thumb--${variant}.png` : 'thumb.png';
    return { ...v, target: slug, glb: glbName ? `${slug}/${v.id}/${glbName}` : null, report: glbName && fs.existsSync(path.join(historyDir(slug), v.id, reportName)) ? `${slug}/${v.id}/${reportName}` : null, thumb: fs.existsSync(path.join(historyDir(slug), v.id, thumbName)) ? `${slug}/${v.id}/${thumbName}` : null, sheet: `${slug}/${v.id}/sheet.png` };
  });
  let setName = null;
  try {
    setName = setOfAsset(slug);
  } catch {
    setName = null;
  }
  const fromSet = setName
    ? listVersions(`set:${setName}`).filter((v) => v.stats?.[slug]).map((v) => ({ ...v, triangles: v.stats[slug].triangles, target: `set:${setName}`, glb: variant ? null : `set-${setName}/${v.id}/${slug}.glb`, report: null, thumb: `set-${setName}/${v.id}/thumb.png`, sheet: `set-${setName}/${v.id}/sheet.png` }))
    : [];
  return [...own, ...fromSet].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Minimal unified line diff (LCS-based) for source files. */
export function unifiedDiff(aText, bText, { context = 2, label = 'asset.js', labels = ['A', 'B'] } = {}) {
  const a = aText.split('\n');
  const b = bText.split('\n');
  // Trim the common head/tail first so the LCS table stays small for long files.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  if (!am.length && !bm.length) return '';
  const n = am.length;
  const m = bm.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  // ops: [type, text, lineA, lineB] (1-based line numbers)
  const ops = [];
  for (let k = 0; k < head; k++) ops.push([' ', a[k], k + 1, k + 1]);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (am[i] === bm[j]) {
      ops.push([' ', am[i], head + i + 1, head + j + 1]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push(['-', am[i], head + i + 1, null]);
      i++;
    } else {
      ops.push(['+', bm[j], null, head + j + 1]);
      j++;
    }
  }
  while (i < n) {
    ops.push(['-', am[i], head + i + 1, null]);
    i++;
  }
  while (j < m) {
    ops.push(['+', bm[j], null, head + j + 1]);
    j++;
  }
  for (let k = 0; k < tail; k++) ops.push([' ', a[a.length - tail + k], a.length - tail + k + 1, b.length - tail + k + 1]);
  const changed = ops.map((o) => o[0] !== ' ');
  // Group changed lines (plus context) into hunks.
  const hunks = [];
  let cur = null;
  for (let k = 0; k < ops.length; k++) {
    if (!changed[k]) continue;
    const start = Math.max(0, k - context);
    const end = Math.min(ops.length - 1, k + context);
    if (cur && start <= cur.end + 1) cur.end = end;
    else {
      cur = { start, end };
      hunks.push(cur);
    }
  }
  const out = [`--- ${label} (${labels[0]})`, `+++ ${label} (${labels[1]})`];
  for (const h of hunks) {
    const slice = ops.slice(h.start, h.end + 1);
    const aStart = slice.find((o) => o[2] !== null)?.[2] ?? 0;
    const bStart = slice.find((o) => o[3] !== null)?.[3] ?? 0;
    const aLen = slice.filter((o) => o[0] !== '+').length;
    const bLen = slice.filter((o) => o[0] !== '-').length;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of slice) out.push(`${o[0]}${o[1]}`);
  }
  return out.join('\n');
}
