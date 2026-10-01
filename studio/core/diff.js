// Version diffs: render two states of an asset (saved versions or the working copy) with one
// shared camera per view, mark the pixels that changed, and diff the source. A revision is
// "local" when the red stays inside the area the user asked to change.

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { parseTarget, workingState, getVersion, versionAssetSource, versionSetSource, unifiedDiff, historyDir } from './history.js';
import { buildItem } from './build.js';
import { paths, assetDir, itemId, rel } from './paths.js';
import { listFiles, ensureDir, writeJson } from './fsutil.js';
import { dataUrlToBuffer, readPNG, writeDataUrl } from './render/image.js';
import { loadConfig } from './config.js';

export const WORKING = 'working';
const BG = [0x4b, 0x50, 0x57];
const RED = [255, 45, 85];
const ORANGE = [255, 150, 40];
const TEXT_EXT = new Set(['.js', '.json', '.md', '.txt']);

/**
 * Resolve the two sides of a diff. specs: [] | [a] | [a, b] where each is 'vNNN' or 'working'.
 * Default: head → working copy when there are unsaved changes, else parent → current version.
 */
export function resolveSides(target, specs = []) {
  const t = parseTarget(target);
  const state = workingState(t);
  const norm = (s) => (['working', 'wc', 'current'].includes(String(s)) ? WORKING : getVersion(t, s).id);
  let a;
  let b;
  if (specs.length >= 2) {
    a = norm(specs[0]);
    b = norm(specs[1]);
  } else if (specs.length === 1) {
    a = norm(specs[0]);
    b = WORKING;
  } else {
    if (!state.versions.length) throw new Error(`no saved versions for ${t.label}; save one first (node studio save ${t.label} -m "...")`);
    if (state.dirty) {
      a = state.head.id;
      b = WORKING;
    } else {
      const cur = state.current;
      const idx = state.versions.findIndex((v) => v.id === cur.id);
      const parent = state.versions.find((v) => v.id === cur.parent) || state.versions[idx - 1];
      if (!parent) throw new Error(`${t.label} has a single saved version (${cur.id}) and no unsaved changes: nothing to compare yet`);
      a = parent.id;
      b = cur.id;
    }
  }
  return { t, a, b, state };
}

function statsFromReport(r) {
  return { triangles: r.triangles.total, dimensions: r.dimensions.meters, materials: r.materials.length, meshes: r.meshCount, errors: r.counts.error, warnings: r.counts.warning };
}

async function sideInfo(t, side, slug) {
  if (side === WORKING) {
    const { report } = await buildItem({ slug, variant: null, profileId: 'generic' });
    return { label: 'working copy', short: 'working', url: `files/preview/${itemId(slug, null)}/generic.glb`, stats: statsFromReport(report), note: null };
  }
  const v = getVersion(t, side);
  const file = t.kind === 'set' ? `${slug}.glb` : 'generic.glb';
  if (!fs.existsSync(path.join(historyDir(t), v.id, file))) return null;
  return { label: v.id, short: v.id, url: `files/history/${t.key}/${v.id}/${file}`, stats: v.stats[slug], note: v.note };
}

/** Source folders of one side: [{prefix, dir}] (prefix is the repo-relative folder name). */
function sourceRoots(t, side) {
  if (t.kind === 'asset') return [{ prefix: `assets/${t.name}`, dir: side === WORKING ? assetDir(t.name) : versionAssetSource(t, side, t.name) }];
  const roots = [{ prefix: `sets/${t.name}`, dir: side === WORKING ? path.join(paths.sets, t.name) : versionSetSource(t, side) }];
  for (const m of t.members) roots.push({ prefix: `assets/${m}`, dir: side === WORKING ? assetDir(m) : versionAssetSource(t, side, m) });
  return roots;
}

/** Unified diff of every text file under the two sides. */
export function sourceDiff(t, a, b) {
  const ra = sourceRoots(t, a);
  const rb = sourceRoots(t, b);
  const chunks = [];
  let added = 0;
  let removed = 0;
  const files = [];
  for (let i = 0; i < ra.length; i++) {
    const names = new Set([...listFiles(ra[i].dir), ...listFiles(rb[i].dir)]);
    for (const name of [...names].sort()) {
      if (!TEXT_EXT.has(path.extname(name))) continue;
      const fa = path.join(ra[i].dir, name);
      const fb = path.join(rb[i].dir, name);
      const ta = fs.existsSync(fa) ? fs.readFileSync(fa, 'utf8') : '';
      const tb = fs.existsSync(fb) ? fs.readFileSync(fb, 'utf8') : '';
      if (ta === tb) continue;
      const d = unifiedDiff(ta, tb, { label: `${ra[i].prefix}/${name}`, labels: [a === WORKING ? 'working copy' : a, b === WORKING ? 'working copy' : b] });
      for (const line of d.split('\n').slice(2)) {
        if (line.startsWith('+')) added++;
        else if (line.startsWith('-')) removed++;
      }
      files.push(`${ra[i].prefix}/${name}`);
      chunks.push(d);
    }
  }
  return { text: chunks.join('\n\n'), files, added, removed };
}

function toDataUrl(png) {
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

/**
 * Changed-pixel heatmap: B (the newer state) faded to gray; strong changes (shape, parts, clear
 * color changes; same threshold as the parity check) in red, subtle ones (slight color or
 * shading shifts such as added grime) in orange. Both renders come from the same deterministic
 * renderer and camera, so unchanged pixels are identical and even subtle marks are real.
 * Returns ratios relative to the object's pixels and the bounding box of the strong changes.
 */
export function heatmap(a, b, { threshold = 0.12, subtleThreshold = 0.03 } = {}) {
  const { width, height } = b;
  const strongMask = new PNG({ width, height });
  const subtleMask = new PNG({ width, height });
  const opts = { includeAA: false, diffMask: true, diffColor: [255, 0, 0], diffColorAlt: [255, 0, 0] };
  const changed = pixelmatch(a.data, b.data, strongMask.data, width, height, { ...opts, threshold });
  const changedSubtle = pixelmatch(a.data, b.data, subtleMask.data, width, height, { ...opts, threshold: Math.min(subtleThreshold, threshold) });
  const out = new PNG({ width, height });
  let fg = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let sx0 = width;
  let sy0 = height;
  let sx1 = -1;
  let sy1 = -1;
  const isFg = (img, i) => Math.abs(img.data[i] - BG[0]) + Math.abs(img.data[i + 1] - BG[1]) + Math.abs(img.data[i + 2] - BG[2]) > 6;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (isFg(a, i) || isFg(b, i)) fg++;
      const strong = strongMask.data[i + 3] > 0;
      const subtle = !strong && subtleMask.data[i + 3] > 0;
      if (strong) {
        out.data.set(RED, i);
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      } else if (subtle) {
        out.data.set(ORANGE, i);
        if (x < sx0) sx0 = x;
        if (y < sy0) sy0 = y;
        if (x > sx1) sx1 = x;
        if (y > sy1) sy1 = y;
      } else {
        const lum = 0.299 * b.data[i] + 0.587 * b.data[i + 1] + 0.114 * b.data[i + 2];
        const g = Math.round(30 + lum * 0.42);
        out.data[i] = g;
        out.data[i + 1] = g;
        out.data[i + 2] = g + 4;
      }
      out.data[i + 3] = 255;
    }
  }
  const frac = (ax0, ay0, ax1, ay1) => (ax1 >= 0 ? { x0: ax0 / width, y0: ay0 / height, x1: (ax1 + 1) / width, y1: (ay1 + 1) / height } : null);
  const box = frac(x0, y0, x1, y1);
  const subtleBox = frac(Math.min(x0, sx0), Math.min(y0, sy0), Math.max(x1, sx1), Math.max(y1, sy1));
  if (box) {
    // Outline the strongly changed region so tiny edits are easy to spot.
    const pad = 4;
    const bx0 = Math.max(0, x0 - pad);
    const by0 = Math.max(0, y0 - pad);
    const bx1 = Math.min(width - 1, x1 + pad);
    const by1 = Math.min(height - 1, y1 + pad);
    const put = (x, y) => out.data.set([255, 200, 87], (y * width + x) * 4);
    for (let x = bx0; x <= bx1; x++) {
      if ((x >> 2) % 2) continue;
      put(x, by0);
      put(x, by1);
    }
    for (let y = by0; y <= by1; y++) {
      if ((y >> 2) % 2) continue;
      put(bx0, y);
      put(bx1, y);
    }
  }
  return {
    image: out,
    changed,
    changedSubtle,
    foreground: fg,
    ratio: fg ? changed / fg : 0,
    subtleRatio: fg ? changedSubtle / fg : 0,
    box,
    subtleBox,
  };
}

/**
 * Render and compare. Requires an open capture api (withCapture).
 * @returns {Promise<object>} summary (also written to diff.json next to sheet.png)
 */
export async function diffTarget(api, target, { specs = [], views, size = 360, threshold } = {}) {
  const config = loadConfig();
  const { t, a, b } = resolveSides(target, specs);
  if (a === b) throw new Error(`both sides are ${a}`);
  const viewList = views || (t.kind === 'set' ? ['iso'] : ['front', 'right', 'iso']);
  const th = threshold ?? config.parity.pixelThreshold;
  const outDir = path.join(paths.shots, '_diff', t.key, `${a}__${b}`);
  ensureDir(outDir);
  const members = [];
  const tiles = [];
  for (const slug of t.members) {
    const sa = await sideInfo(t, a, slug);
    const sb = await sideInfo(t, b, slug);
    if (!sa || !sb) {
      members.push({ slug, missing: !sa ? a : b });
      continue;
    }
    const boxA = await api.boxGLB({ url: `${api.url}${sa.url}` });
    const boxB = await api.boxGLB({ url: `${api.url}${sb.url}` });
    const frameBox = {
      min: boxA.min.map((v, i) => Math.min(v, boxB.min[i])),
      max: boxA.max.map((v, i) => Math.max(v, boxB.max[i])),
    };
    const ra = await api.renderGLB({ url: `${api.url}${sa.url}`, views: viewList, size, frameBox });
    const rb = await api.renderGLB({ url: `${api.url}${sb.url}`, views: viewList, size, frameBox });
    const perView = {};
    let max = 0;
    let maxSubtle = 0;
    for (const v of viewList) {
      const ia = readPNG(dataUrlToBuffer(ra.images[v]));
      const ib = readPNG(dataUrlToBuffer(rb.images[v]));
      const h = heatmap(ia, ib, { threshold: th });
      const round3 = (bx) => bx && Object.fromEntries(Object.entries(bx).map(([k, x]) => [k, +x.toFixed(3)]));
      perView[v] = { ratio: +h.ratio.toFixed(4), subtleRatio: +h.subtleRatio.toFixed(4), changedPixels: h.changed, box: round3(h.box), subtleBox: round3(h.subtleBox) };
      max = Math.max(max, h.ratio);
      maxSubtle = Math.max(maxSubtle, h.subtleRatio);
      const prefix = t.kind === 'set' ? `${slug} · ` : '';
      tiles.push({ image: ra.images[v], label: `${prefix}A ${sa.short} · ${v}` });
      tiles.push({ image: rb.images[v], label: `${prefix}B ${sb.short} · ${v}` });
      const subtle = h.subtleRatio - h.ratio > 0.0005 ? ` + ${((h.subtleRatio - h.ratio) * 100).toFixed(1)}% subtle` : '';
      tiles.push({ image: toDataUrl(h.image), label: `changed ${(h.ratio * 100).toFixed(1)}%${subtle} · ${v}` });
    }
    members.push({ slug, a: sa.stats, b: sb.stats, views: perView, maxRatio: +max.toFixed(4), maxSubtleRatio: +maxSubtle.toFixed(4), identical: maxSubtle === 0 });
  }
  const src = sourceDiff(t, a, b);
  fs.writeFileSync(path.join(outDir, 'source.diff'), src.text ? `${src.text}\n` : '');
  const labelOf = (side) => (side === WORKING ? 'working copy' : side);
  const noteOf = (side) => (side === WORKING ? '' : getVersion(t, side).note);
  let sheet = null;
  if (tiles.length) {
    const lines = [];
    if (noteOf(a)) lines.push(`A ${labelOf(a)}: "${noteOf(a)}"`);
    if (noteOf(b)) lines.push(`B ${labelOf(b)}: "${noteOf(b)}"`);
    for (const m of members.filter((x) => x.a)) lines.push(`${t.kind === 'set' ? `${m.slug}: ` : ''}${statsDelta(m.a, m.b)}`);
    const img = await api.sheet({ tiles, columns: 3, tileSize: size, title: `Diff ${t.label}: A ${labelOf(a)} → B ${labelOf(b)}`, lines: lines.slice(0, 4) });
    sheet = rel(writeDataUrl(path.join(outDir, 'sheet.png'), img));
  }
  const summary = {
    target: t.label,
    a: labelOf(a),
    b: labelOf(b),
    views: viewList,
    threshold: th,
    sheet,
    dir: rel(outDir),
    members,
    source: { files: src.files, added: src.added, removed: src.removed, patch: rel(path.join(outDir, 'source.diff')) },
  };
  writeJson(path.join(outDir, 'diff.json'), summary);
  return { ...summary, sourceText: src.text };
}

export function statsDelta(sa, sb) {
  const d = (x) => `${x > 0 ? '+' : ''}${x.toLocaleString('en-US')}`;
  const dims = (s) => s.dimensions.map((v) => v.toFixed(2)).join('×');
  const parts = [`triangles ${sa.triangles.toLocaleString('en-US')} → ${sb.triangles.toLocaleString('en-US')} (${d(sb.triangles - sa.triangles)})`];
  parts.push(dims(sa) === dims(sb) ? `size ${dims(sb)} m (same)` : `size ${dims(sa)} → ${dims(sb)} m`);
  parts.push(sa.materials === sb.materials ? `${sb.materials} materials` : `materials ${sa.materials} → ${sb.materials}`);
  if (sa.errors !== sb.errors || sa.warnings !== sb.warnings) parts.push(`issues ${sa.errors}E/${sa.warnings}W → ${sb.errors}E/${sb.warnings}W`);
  return parts.join(' · ');
}
