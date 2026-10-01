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
  let parityResult = null;
  if (parity) {
    const pViews = PARITY_VIEWS;
    const src = await api.renderSource({ slug, variant, views: pViews, size: tile });
    const glbP = await api.renderGLB({ url: glbUrl, views: pViews, size: tile });
    const perView = {};
    let max = 0;
    for (const v of pViews) {
      const a = readPNG(dataUrlToBuffer(src.images[v]));
      const b = readPNG(dataUrlToBuffer(glbP.images[v]));
      const d = diffImages(a, b, { threshold: config.parity.pixelThreshold });
      perView[v] = +d.ratio.toFixed(4);
      max = Math.max(max, d.ratio);
      writePNG(path.join(dir, 'parity', `${v}.png`), sideBySide([a, b, d.diff]));
    }
    parityResult = { views: perView, max: +max.toFixed(4), threshold: config.parity.maxDiffRatio, ok: max <= config.parity.maxDiffRatio, images: rel(path.join(dir, 'parity')) };
    writeJson(path.join(dir, 'parity.json'), parityResult);
    // Attach parity to the preview report so the viewport and export see it.
    const reportFile = previewReport(slug, variant, profileId);
    const r = readJson(reportFile, null);
    if (r) {
      r.parity = parityResult;
      r.issues = r.issues.filter((i) => i.id !== 'parity.mismatch');
      if (!parityResult.ok) {
        r.issues.push({ id: 'parity.mismatch', severity: 'warning', message: `source scene and exported GLB differ by up to ${(max * 100).toFixed(1)}% of the object's pixels (limit ${(config.parity.maxDiffRatio * 100).toFixed(1)}%)`, hint: `Open ${rel(path.join(dir, 'parity'))} (source | GLB | diff) to see what the export changed.` });
        r.counts.warning++;
      }
      writeJson(reportFile, r);
    }
  }
  return { slug, variant, profile: profileId, report: readJson(previewReport(slug, variant, profileId)), sheet: rel(sheetFile), dir: rel(dir), parity: parityResult, glb: rel(previewGlb(slug, variant, profileId)) };
}

/** Lineup of several items (set members or variants) at true relative scale. */
export async function lineup(api, items, profileId, file) {
  const img = await api.lineup({
    items: items.map((it) => ({ url: `${api.url}files/preview/${itemId(it.slug, it.variant)}/${profileId}.glb`, label: it.variant ? `${it.slug} — ${it.variant}` : it.slug })),
  });
  return rel(writeDataUrl(file, img));
}
