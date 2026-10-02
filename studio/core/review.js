// Visual review: multi-view contact sheets of the exported GLB, plus the parity check
// (source scene vs re-imported GLB from identical cameras).

import fs from 'node:fs';
import path from 'node:path';
import { paths, itemId, previewGlb, previewReport, rel } from './paths.js';
import { buildItem } from './build.js';
import { readJson, writeJson, ensureDir } from './fsutil.js';
import { loadConfig } from './config.js';
import { dataUrlToBuffer, diffImages, readPNG, writeDataUrl, writePNG, sideBySide } from './render/image.js';
import { loadAssetDef } from './load-asset.js';

export const PARITY_VIEWS = ['front', 'right', 'top', 'iso'];

export function shotsDir(slug, variant, profileId, skin = null) {
  return path.join(paths.shots, itemId(slug, variant, skin), profileId);
}

function headerLines(report) {
  const d = report.dimensions.meters.map((v) => v.toFixed(2)).join(' × ');
  const stats = `${d} m · ${report.triangles.total.toLocaleString('en-US')} tris · ${report.meshCount} mesh · ${report.materials.length} mat · ${report.counts.error} err / ${report.counts.warning} warn · ${report.profile.label}`;
  return [report.prompt ? `Prompt: ${report.prompt}` : '', stats].filter(Boolean);
}

const previewUrl = (api, slug, variant, profileId, skin) => `${api.url}files/preview/${itemId(slug, variant, skin)}/${profileId}.glb`;

/**
 * Render a contact sheet (and optionally parity) for one item. Requires an open capture api.
 */
export async function reviewItem(api, { slug, variant = null, skin = null, profileId = 'generic', parity = true, parts = true, blueprint = true, views, size, force = false }) {
  const config = loadConfig();
  const viewList = views || config.review.views;
  const tile = size || config.review.size;
  const { report } = await buildItem({ slug, variant, skin, profileId, force });
  const dir = shotsDir(slug, variant, profileId, skin);
  ensureDir(dir);
  const glb = await api.renderGLB({ url: previewUrl(api, slug, variant, profileId, skin), views: viewList, size: tile });
  for (const [v, img] of Object.entries(glb.images)) writeDataUrl(path.join(dir, `${v}.png`), img);
  const sheet = await api.sheet({
    tiles: viewList.map((v) => ({ image: glb.images[v], label: v })),
    columns: 3,
    tileSize: tile,
    title: `${report.title}${variant ? ` — ${variant}` : ''}${skin ? ` · skin ${skin}` : ''}`,
    lines: headerLines(report),
  });
  const sheetFile = writeDataUrl(path.join(dir, 'sheet.png'), sheet);
  const parityResult = parity ? await parityCheck(api, { slug, variant, skin, profileId, size: tile }) : null;
  const extra = {};
  if (parts) extra.parts = await partsSheet(api, { slug, variant, skin, profileId, size: tile, title: report.title });
  if (blueprint) extra.blueprint = await blueprintSheet(api, { slug, variant, skin, profileId, size: tile, title: report.title });
  const def = await loadAssetDef(slug);
  if (def.meta.reference) extra.reference = await referenceSheet(api, { slug, variant, skin, profileId, reference: def.meta.reference });
  return { slug, variant, skin, profile: profileId, report: readJson(previewReport(slug, variant, profileId, skin)), sheet: rel(sheetFile), dir: rel(dir), parity: parityResult, glb: rel(previewGlb(slug, variant, profileId, skin)), ...extra };
}

/**
 * Parts view: the source scene with one flat color per k.part, labeled, plus a legend with
 * triangles and sizes. Shows which code made which piece (the GLB merges non-separate parts).
 */
export async function partsSheet(api, { slug, variant = null, skin = null, profileId = 'generic', size = 512, title = slug }) {
  const r = await api.renderParts({ slug, variant, skin, views: ['front', 'top', 'iso'], size });
  const sheet = await api.sheet({
    tiles: [['front', r.images.front], ['top', r.images.top], ['iso', r.images.iso], ['legend', r.images.legend]].map(([label, image]) => ({ image, label })),
    columns: 2,
    tileSize: size,
    title: `${title} — parts`,
    lines: [`${r.parts.length} part(s): ${r.parts.map((p) => `${p.name} (${p.triangles.toLocaleString('en-US')} tris)`).join(', ')}`],
  });
  return { file: rel(writeDataUrl(path.join(shotsDir(slug, variant, profileId, skin), 'parts.png'), sheet)), parts: r.parts };
}

/** Blueprint: orthographic views of the GLB with a metric grid, rulers and overall sizes. */
export async function blueprintSheet(api, { slug, variant = null, skin = null, profileId = 'generic', size = 512, title = slug }) {
  const r = await api.blueprint({ url: previewUrl(api, slug, variant, profileId, skin), views: ['front', 'top', 'right'], size });
  const fmt = (d) => `${(d.width * 100).toFixed(1)} × ${(d.height * 100).toFixed(1)} cm`;
  const sheet = await api.sheet({
    tiles: Object.entries(r.images).map(([label, image]) => ({ image, label })),
    columns: 3,
    tileSize: size,
    title: `${title} — blueprint (orthographic, meters)`,
    lines: [`front ${fmt(r.dims.front)} · top ${fmt(r.dims.top)} · right ${fmt(r.dims.right)} · rulers start at the model's min corner`],
  });
  return { file: rel(writeDataUrl(path.join(shotsDir(slug, variant, profileId, skin), 'blueprint.png'), sheet)), dims: r.dims };
}

/** Reference overlay: model silhouette vs the asset's reference image (meta.reference). */
export async function referenceSheet(api, { slug, variant = null, skin = null, profileId = 'generic', reference }) {
  const ref = typeof reference === 'string' ? { image: reference } : reference;
  const file = path.join(paths.assets, slug, ref.image);
  if (!fs.existsSync(file)) return { file: null, iou: null, missing: rel(file) };
  const r = await api.referenceOverlay({ url: previewUrl(api, slug, variant, profileId, skin), image: `${api.url}assets/${slug}/${ref.image}`, view: ref.view || 'front', size: 768 });
  return { file: rel(writeDataUrl(path.join(shotsDir(slug, variant, profileId, skin), 'reference.png'), r.sheet)), iou: +r.iou.toFixed(3) };
}

/**
 * Skin sheet: the base look and every skin of one item from the same cameras, labeled, so
 * looks can be compared side by side. Every look must already be built.
 * Writes .studio/shots/<item>/<profile>/skins.png.
 */
export async function skinSheet(api, { slug, variant = null, profileId = 'generic', skins, views = ['iso', 'front'], size = 384 }) {
  const looks = [null, ...skins];
  const reports = looks.map((s) => readJson(previewReport(slug, variant, profileId, s)));
  const box = await api.boxGLB({ url: previewUrl(api, slug, variant, profileId, null) });
  const tiles = [];
  for (const v of views) {
    for (let i = 0; i < looks.length; i++) {
      const r = await api.renderGLB({ url: previewUrl(api, slug, variant, profileId, looks[i]), views: [v], size, frameBox: box });
      const errs = reports[i].counts.error;
      tiles.push({ image: r.images[v], label: `${looks[i] || 'default'}${views.length > 1 ? ` · ${v}` : ''}${errs ? ` · ${errs} error(s)` : ''}` });
    }
  }
  const base = reports[0];
  const columns = Math.min(4, looks.length);
  const sheet = await api.sheet({
    tiles,
    columns,
    tileSize: size,
    title: `${base.title}${variant ? ` — ${variant}` : ''} · ${looks.length} looks (default + ${skins.length} skin${skins.length === 1 ? '' : 's'})`,
    lines: [
      `${base.triangles.total.toLocaleString('en-US')} tris · ${base.meshCount} mesh · ${base.materials.length} mat · same mesh for every look (skin lock) · ${base.profile.label}`,
    ],
  });
  const file = path.join(shotsDir(slug, variant, profileId), 'skins.png');
  return rel(writeDataUrl(file, sheet));
}

/**
 * Parity: render the source scene (built in the browser from the same asset module) and the
 * exported GLB from identical cameras and compare them. Writes source | GLB | diff images and
 * attaches the result to the preview report (a mismatch adds a 'parity.mismatch' warning).
 */
export async function parityCheck(api, { slug, variant = null, skin = null, profileId = 'generic', size }) {
  const config = loadConfig();
  const tile = size || config.review.size;
  const dir = shotsDir(slug, variant, profileId, skin);
  const src = await api.renderSource({ slug, variant, skin, views: PARITY_VIEWS, size: tile });
  const glbP = await api.renderGLB({ url: previewUrl(api, slug, variant, profileId, skin), views: PARITY_VIEWS, size: tile });
  const perView = {};
  let max = 0;
  for (const v of PARITY_VIEWS) {
    const a = readPNG(dataUrlToBuffer(src.images[v]));
    const b = readPNG(dataUrlToBuffer(glbP.images[v]));
    const d = diffImages(a, b, { threshold: config.parity.pixelThreshold });
    perView[v] = +d.ratio.toFixed(4);
    max = Math.max(max, d.ratio);
    writePNG(path.join(dir, 'parity', `${v}.png`), sideBySide([a, b, d.diff]));
  }
  const result = { views: perView, max: +max.toFixed(4), threshold: config.parity.maxDiffRatio, ok: max <= config.parity.maxDiffRatio, images: rel(path.join(dir, 'parity')) };
  writeJson(path.join(dir, 'parity.json'), result);
  const reportFile = previewReport(slug, variant, profileId, skin);
  const r = readJson(reportFile, null);
  if (r) {
    r.parity = result;
    const had = r.issues.some((i) => i.id === 'parity.mismatch');
    r.issues = r.issues.filter((i) => i.id !== 'parity.mismatch');
    if (had) r.counts.warning--;
    if (!result.ok) {
      r.issues.push({ id: 'parity.mismatch', severity: 'warning', message: `source scene and exported GLB differ by up to ${(max * 100).toFixed(1)}% of the object's pixels (limit ${(config.parity.maxDiffRatio * 100).toFixed(1)}%)`, hint: `Open ${rel(path.join(dir, 'parity'))} (source | GLB | diff) to see what the export changed.` });
      r.counts.warning++;
    }
    writeJson(reportFile, r);
  }
  return result;
}

/** Lineup of several items (set members or variants) at true relative scale. */
export async function lineup(api, items, profileId, file) {
  const img = await api.lineup({
    items: items.map((it) => ({ url: previewUrl(api, it.slug, it.variant, profileId, it.skin || null), label: `${it.slug}${it.variant ? ` — ${it.variant}` : ''}${it.skin ? ` @${it.skin}` : ''}` })),
  });
  return rel(writeDataUrl(file, img));
}
