// Strict export: the preview GLB becomes an engine file only when
//   1. the preflight has 0 errors,
//   2. a fresh rebuild produces the same bytes as the preview (Preview = Export, deterministic),
//   3. (optional) the parity render was run and recorded.
// Writes exports/<profile>/<slug>[--variant][@skin].glb + .report.json + .report.md.

import fs from 'node:fs';
import path from 'node:path';
import { buildItem, computeSourceHash } from './build.js';
import { parityCheck } from './review.js';
import { paths, itemId, previewGlb, previewReport, rel } from './paths.js';
import { ensureDir, readJson, sha256, writeFileAtomic, writeJson } from './fsutil.js';
import { reportMarkdown } from './report.js';
import { loadAssetDef } from './load-asset.js';
import { setOfAsset } from './targets.js';
import { loadProfile } from '../profiles/index.js';
import { assetSetupCommand, hasSetup, setupData, setupRbxmx } from './setup.js';

export function exportPaths(slug, variant, profileId, skin = null) {
  const base = path.join(paths.exports, profileId, itemId(slug, variant, skin));
  return { glb: `${base}.glb`, json: `${base}.report.json`, md: `${base}.report.md`, setup: `${base}.setup.json`, setupScript: `${base}.setup.rbxmx`, setupCommand: `${base}.setup.lua` };
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
  const def = await loadAssetDef(slug);
  const expectedSource = computeSourceHash(slug, variant, profileId, def.meta.set || setOfAsset(slug), skin) + (allowDecimate ? ':dec' : '');
  if (expectedSource !== report.hashes.source) {
    return { slug, variant, skin, id, profile: profileId, blocked: true, reason: 'source changed while exporting; rebuild the selected look', errors: [], report };
  }
  const finalReport = readJson(previewReport(slug, variant, profileId, skin));
  const out = exportPaths(slug, variant, profileId, skin);
  ensureDir(path.dirname(out.glb));
  writeFileAtomic(out.glb, previewBytes);
  // Attachments and collision travel next to the GLB (a GLB cannot carry them for every engine).
  const setup = hasSetup(finalReport) ? setupData(finalReport) : null;
  const setupScript = !!setup && !!loadProfile(profileId).metadata?.setupScript;
  if (setup) writeJson(out.setup, setup);
  else fs.rmSync(out.setup, { force: true });
  if (setupScript) {
    writeFileAtomic(out.setupScript, setupRbxmx(setup));
    writeFileAtomic(out.setupCommand, assetSetupCommand(setup));
  } else {
    fs.rmSync(out.setupScript, { force: true });
    fs.rmSync(out.setupCommand, { force: true });
  }
  const exported = {
    ...finalReport,
    file: { ...finalReport.file, path: rel(out.glb), preview: finalReport.file.path },
    export: {
      exportedAt: new Date().toISOString(),
      previewMatch: true,
      sha256: previewHash,
      parity: parityResult ? { max: parityResult.max, ok: parityResult.ok, views: parityResult.views } : null,
      ...(setup ? { setup: { json: rel(out.setup), ...(setupScript ? { rbxmx: rel(out.setupScript), command: rel(out.setupCommand) } : {}) } } : {}),
    },
  };
  writeJson(out.json, exported);
  fs.writeFileSync(out.md, reportMarkdown(exported));
  if (computeSourceHash(slug, variant, profileId, def.meta.set || setOfAsset(slug), skin) + (allowDecimate ? ':dec' : '') !== expectedSource) {
    return { slug, variant, skin, id, profile: profileId, blocked: true, reason: 'source changed while exporting; rebuild the selected look', errors: [], report };
  }
  recordExport(slug, profileId, rel(out.glb));
  const files = { glb: rel(out.glb), json: rel(out.json), md: rel(out.md), ...(setup ? { setup: rel(out.setup) } : {}), ...(setupScript ? { setupScript: rel(out.setupScript), setupCommand: rel(out.setupCommand) } : {}) };
  return { slug, variant, skin, id, profile: profileId, blocked: false, files, report: exported, parity: parityResult };
}
