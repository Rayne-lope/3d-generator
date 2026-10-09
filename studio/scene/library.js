// The asset library a scene is assembled from: every asset with its real size, so a person
// or an agent can pick and place without opening each asset.

import fs from 'node:fs';
import path from 'node:path';
import { listAssets, listSets, loadSet } from '../core/targets.js';
import { loadAssetDef } from '../core/load-asset.js';
import { previewReport } from '../core/paths.js';
import { readJson } from '../core/fsutil.js';
import { STUD } from '../viewport/snap.js';
import { scenePaths } from './paths.js';

/** Sidecar of a cached thumbnail: `<item>.png` + `<item>.json` ({ hash }) in .studio/thumbs. */
export function thumbFiles(item) {
  return { png: path.join(scenePaths.thumbs, `${item}.png`), meta: path.join(scenePaths.thumbs, `${item}.json`) };
}

/** URL of a cached thumbnail when it matches the current generic GLB, else null. */
export function thumbUrl(item, glbHash) {
  if (!glbHash) return null;
  const files = thumbFiles(item);
  if (!fs.existsSync(files.png)) return null;
  const meta = readJson(files.meta, null);
  return meta && meta.hash === glbHash ? `/files/thumbs/${item}.png?h=${glbHash.slice(0, 12)}` : null;
}

function sizeOf(report) {
  if (!report) return null;
  // Generic reports are in meters; bounds are relative to the asset origin (base center).
  return {
    meters: report.dimensions.meters,
    studs: report.dimensions.meters.map((v) => +(v / STUD).toFixed(2)),
    bounds: report.bounds,
    triangles: report.triangles.total,
  };
}

/**
 * @param {{set?: string|null, category?: string|null, looks?: boolean}} [opts]
 *   looks: also report the size of every variant (from its generic preview, when built)
 */
export async function libraryEntries({ set = null, category = null, looks = false } = {}) {
  const setOf = new Map();
  for (const name of listSets()) for (const member of loadSet(name).members) setOf.set(member, name);
  const out = [];
  for (const slug of listAssets()) {
    const report = readJson(previewReport(slug, null, 'generic'), null);
    let def = null;
    try {
      def = await loadAssetDef(slug);
    } catch {
      // A broken module is still listed (as not placeable) so the gap is visible.
    }
    const meta = def?.meta || (report ? { title: report.title, category: report.category, style: report.style, set: report.set } : { title: slug });
    const entry = {
      slug,
      title: meta.title || slug,
      category: meta.category || 'prop',
      style: meta.style || [],
      set: meta.set || setOf.get(slug) || null,
      variants: def ? Object.keys(def.variants || {}) : [],
      skins: def ? Object.keys(def.skins || {}) : [],
      built: !!report,
      broken: !def,
      ok: report ? report.counts.error === 0 : null,
      size: sizeOf(report),
      glbHash: report?.hashes?.glb || null,
      thumb: thumbUrl(slug, report?.hashes?.glb),
    };
    if (set && entry.set !== set) continue;
    if (category && entry.category !== category) continue;
    if (looks && entry.variants.length) {
      entry.variantSizes = {};
      for (const variant of entry.variants) entry.variantSizes[variant] = sizeOf(readJson(previewReport(slug, variant, 'generic'), null));
    }
    out.push(entry);
  }
  return out;
}

/** Size of one placeable item (asset + variant + skin) from its generic preview, or null. */
export function itemSize(slug, variant = null, skin = null) {
  return sizeOf(readJson(previewReport(slug, variant, 'generic', skin), null)) || null;
}
