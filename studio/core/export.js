// Strict export: the preview GLB becomes an engine file only when
//   1. the preflight has 0 errors,
//   2. a fresh rebuild produces the same bytes as the preview (Preview = Export, deterministic),
//   3. (optional) the parity render was run and recorded.
// Writes exports/<profile>/<slug>[--variant][@skin].glb + .report.json + .report.md.

import fs from 'node:fs';
import path from 'node:path';
import { buildItem } from './build.js';
import { parityCheck } from './review.js';
import { paths, itemId, previewGlb, previewReport, rel } from './paths.js';
import { ensureDir, readJson, sha256, writeFileAtomic, writeJson } from './fsutil.js';
import { reportMarkdown } from './report.js';

export function exportPaths(slug, variant, profileId, skin = null) {
  const base = path.join(paths.exports, profileId, itemId(slug, variant, skin));
  return { glb: `${base}.glb`, json: `${base}.report.json`, md: `${base}.report.md` };
}

function recordExport(slug, profileId, file) {
  try {
    const m = readJson(paths.metrics, { assets: {} });
    const a = m.assets[slug] || {};
    a.exports = a.exports || {};
    a.exports[profileId] = { at: new Date().toISOString(), file };
    m.assets[slug] = a;
    writeJson(paths.metrics, m);
  } catch {
    // metrics are best effort
  }
}

/**
 * @param {{slug: string, variant?: string|null, skin?: string|null, profileId: string, api?: any, parity?: boolean, allowDecimate?: boolean}} opts
 *   api: an open capture api (withCapture) for the parity render; parity is skipped without it.
 */
export async function exportItem({ slug, variant = null, skin = null, profileId, api = null, parity = true, allowDecimate = false }) {
  const id = itemId(slug, variant, skin);
  const { report } = await buildItem({ slug, variant, skin, profileId, allowDecimate });
  const errors = report.issues.filter((i) => i.severity === 'error');
  if (errors.length) return { slug, variant, skin, id, profile: profileId, blocked: true, reason: `${errors.length} validation error(s)`, errors, report };

  // Preview = Export: an independent rebuild must reproduce the preview byte for byte.
  const fresh = await buildItem({ slug, variant, skin, profileId, write: false, force: true, allowDecimate });
  const previewBytes = fs.readFileSync(previewGlb(slug, variant, profileId, skin));
  const previewHash = sha256(previewBytes);
  const freshHash = sha256(fresh.glb);
  if (previewHash !== freshHash) {
    return {
      slug, variant, skin, id, profile: profileId, blocked: true, report,
      reason: 'a fresh build does not reproduce the preview GLB (non-deterministic build)',
      errors: [{ id: 'export.nondeterministic', severity: 'error', message: `preview sha256 ${previewHash.slice(0, 12)} ≠ fresh build ${freshHash.slice(0, 12)}`, hint: 'Randomness must come from the rng passed to build() (no Math.random, Date or iteration over unordered data).' }],
    };
  }

  let parityResult = null;
  if (parity && api) parityResult = await parityCheck(api, { slug, variant, skin, profileId });
  const finalReport = readJson(previewReport(slug, variant, profileId, skin));
  const out = exportPaths(slug, variant, profileId, skin);
  ensureDir(path.dirname(out.glb));
  writeFileAtomic(out.glb, previewBytes);
  const exported = {
    ...finalReport,
    file: { ...finalReport.file, path: rel(out.glb), preview: finalReport.file.path },
    export: {
      exportedAt: new Date().toISOString(),
      previewMatch: true,
      sha256: previewHash,
      parity: parityResult ? { max: parityResult.max, ok: parityResult.ok, views: parityResult.views } : null,
    },
  };
  writeJson(out.json, exported);
  fs.writeFileSync(out.md, reportMarkdown(exported));
  recordExport(slug, profileId, rel(out.glb));
  return { slug, variant, skin, id, profile: profileId, blocked: false, files: { glb: rel(out.glb), json: rel(out.json), md: rel(out.md) }, report: exported, parity: parityResult };
}
