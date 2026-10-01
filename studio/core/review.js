// Visual review: multi-view contact sheets of the exported GLB, plus the parity check
// (source scene vs re-imported GLB from identical cameras).

import path from 'node:path';
import { paths, itemId, previewGlb, previewReport, rel } from './paths.js';
import { buildItem } from './build.js';
import { readJson, writeJson, ensureDir } from './fsutil.js';
import { loadConfig } from './config.js';
import { dataUrlToBuffer, diffImages, readPNG, writeDataUrl, writePNG, sideBySide } from './render/image.js';

export const PARITY_VIEWS = ['front', 'right', 'top', 'iso'];

export function shotsDir(slug, variant, profileId) {
  return path.join(paths.shots, itemId(slug, variant), profileId);
}

function headerLines(report) {
  const d = report.dimensions.meters.map((v) => v.toFixed(2)).join(' × ');
  const stats = `${d} m · ${report.triangles.total.toLocaleString('en-US')} tris · ${report.meshCount} mesh · ${report.materials.length} mat · ${report.counts.error} err / ${report.counts.warning} warn · ${report.profile.label}`;
  return [report.prompt ? `Prompt: ${report.prompt}` : '', stats].filter(Boolean);
}

/**
 * Render a contact sheet (and optionally parity) for one item. Requires an open capture api.
 */
export async function reviewItem(api, { slug, variant = null, profileId = 'generic', parity = true, views, size, force = false }) {
  const config = loadConfig();
  const viewList = views || config.review.views;
  const tile = size || config.review.size;
  const { report } = await buildItem({ slug, variant, profileId, force });
  const dir = shotsDir(slug, variant, profileId);
  ensureDir(dir);
  const glbUrl = `${api.url}files/preview/${itemId(slug, variant)}/${profileId}.glb`;
  const glb = await api.renderGLB({ url: glbUrl, views: viewList, size: tile });
  for (const [v, img] of Object.entries(glb.images)) writeDataUrl(path.join(dir, `${v}.png`), img);
  const sheet = await api.sheet({
    tiles: viewList.map((v) => ({ image: glb.images[v], label: v })),
    columns: 3,
    tileSize: tile,
    title: `${report.title}${variant ? ` — ${variant}` : ''}`,
    lines: headerLines(report),
  });
  const sheetFile = writeDataUrl(path.join(dir, 'sheet.png'), sheet);
  const parityResult = parity ? await parityCheck(api, { slug, variant, profileId, size: tile }) : null;
  return { slug, variant, profile: profileId, report: readJson(previewReport(slug, variant, profileId)), sheet: rel(sheetFile), dir: rel(dir), parity: parityResult, glb: rel(previewGlb(slug, variant, profileId)) };
}

/**
 * Parity: render the source scene (built in the browser from the same asset module) and the
 * exported GLB from identical cameras and compare them. Writes source | GLB | diff images and
 * attaches the result to the preview report (a mismatch adds a 'parity.mismatch' warning).
 */
export async function parityCheck(api, { slug, variant = null, profileId = 'generic', size }) {
  const config = loadConfig();
  const tile = size || config.review.size;
  const dir = shotsDir(slug, variant, profileId);
  const glbUrl = `${api.url}files/preview/${itemId(slug, variant)}/${profileId}.glb`;
  const src = await api.renderSource({ slug, variant, views: PARITY_VIEWS, size: tile });
  const glbP = await api.renderGLB({ url: glbUrl, views: PARITY_VIEWS, size: tile });
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
  const reportFile = previewReport(slug, variant, profileId);
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
    items: items.map((it) => ({ url: `${api.url}files/preview/${itemId(it.slug, it.variant)}/${profileId}.glb`, label: it.variant ? `${it.slug} — ${it.variant}` : it.slug })),
  });
  return rel(writeDataUrl(file, img));
}
