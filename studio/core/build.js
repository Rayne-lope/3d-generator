// Build one item (asset or variant) for one engine profile:
// asset module → three.js scene → IR → profile transforms → GLB → inspect → validate → report.
// The preview GLB written here is byte-for-byte what `export` would write.

import fs from 'node:fs';
import path from 'node:path';
import { runAsset, KIT_VERSION } from '../kit/index.js';
import { sceneToIR, ExportError } from './ir/from-three.js';
import { irToGLB } from './ir/to-gltf.js';
import { applyProfile } from './transforms/index.js';
import { inspectGLB } from './inspect.js';
import { validate } from './validate/index.js';
import { makeReport } from './report.js';
import { loadAssetDef } from './load-asset.js';
import { loadProfile } from '../profiles/index.js';
import { paths, assetDir, previewGlb, previewReport, itemId, rel } from './paths.js';
import { hashDirs, listFiles, readJson, sha256, writeFileAtomic, writeJson } from './fsutil.js';
import { setOfAsset } from './targets.js';

const PIPELINE_DIRS = [paths.kit, path.join(paths.root, 'studio', 'core'), paths.profiles];

export function sourceDirsFor(slug, setName) {
  return [assetDir(slug), setName ? path.join(paths.sets, setName) : null].filter(Boolean);
}

export function computeSourceHash(slug, variant, profileId, setName, skin = null) {
  return hashDirs([...sourceDirsFor(slug, setName), ...PIPELINE_DIRS], `${KIT_VERSION}|${profileId}|${variant || ''}${skin ? `|@${skin}` : ''}`);
}

function recordMetrics(slug) {
  try {
    const m = readJson(paths.metrics, { assets: {} });
    const a = m.assets[slug] || {};
    const now = new Date().toISOString();
    if (!a.firstGlbAt) a.firstGlbAt = now;
    a.lastBuildAt = now;
    a.builds = (a.builds || 0) + 1;
    m.assets[slug] = a;
    writeJson(paths.metrics, m);
  } catch {
    // metrics are best effort
  }
}

/**
 * @param {{slug: string, variant?: string|null, skin?: string|null, profileId?: string, write?: boolean, force?: boolean, allowDecimate?: boolean}} opts
 * @returns {Promise<{glb: Uint8Array, report: any, cached: boolean, info?: any, ir?: any}>}
 */
export async function buildItem({ slug, variant = null, skin = null, profileId = 'generic', write = true, force = false, allowDecimate = false }) {
  const t0 = performance.now();
  const profile = loadProfile(profileId);
  const def = await loadAssetDef(slug);
  const setName = def.meta.set || setOfAsset(slug);
  const sourceHash = computeSourceHash(slug, variant, profileId, setName, skin) + (allowDecimate ? ':dec' : '');
  const glbFile = previewGlb(slug, variant, profileId, skin);
  const reportFile = previewReport(slug, variant, profileId, skin);
  if (!force && write && fs.existsSync(glbFile) && fs.existsSync(reportFile)) {
    const prev = readJson(reportFile, null);
    if (prev && prev.hashes?.source === sourceHash) {
      return { glb: new Uint8Array(fs.readFileSync(glbFile)), report: prev, cached: true };
    }
  }
  // Assets with skins keep every declared material and palette swatch, so all skins share
  // one mesh layout (same materials, same UVs) and engines can swap their textures.
  const skinned = Object.keys(def.skins || {}).length > 0;
  const run = runAsset(def, { variant, skin });
  const ir = sceneToIR(run.root, { slug, variant, skin, meta: def.meta, keepMaterials: skinned });
  await applyProfile(ir, profile, { allowDecimate, stablePalette: skinned });
  const { glb } = await irToGLB(ir, {
    profileId,
    allowEmissiveStrength: profile.materials.emissiveStrength,
    keepMaterialNames: skinned,
    extras: { title: def.meta.title, sourceHash, kit: KIT_VERSION },
  });
  const info = await inspectGLB(glb);
  const sourceFiles = sourceDirsFor(slug, setName).flatMap((dir) => listFiles(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f)));
  // A skin is checked against the base look of the same item and profile (skin lock).
  const skinBase = skin ? { skin, report: (await buildItem({ slug, variant, profileId, allowDecimate })).report } : null;
  const validation = await validate({ glb, info, ir, profile, meta: def.meta, sourceFiles, skinBase });
  const glbHash = sha256(glb);
  const report = makeReport({
    slug, variant, skin, id: itemId(slug, variant, skin), def, setName, profile, glbPath: rel(glbFile), glbBytes: glb.byteLength, glbHash,
    info, ir, validation, sourceHash, buildMs: performance.now() - t0,
  });
  if (write) {
    writeFileAtomic(glbFile, glb);
    writeJson(reportFile, report);
    recordMetrics(slug);
  }
  return { glb, report, cached: false, info, ir };
}

/** Format an exception from asset code or the pipeline for the terminal/agent. */
export function describeError(err, slug) {
  const lines = [];
  lines.push(err instanceof ExportError ? `export error: ${err.message}` : `${err.name || 'Error'}: ${err.message}`);
  if (err.hint) lines.push(`fix: ${err.hint}`);
  const stack = String(err.stack || '').split('\n').filter((l) => l.includes(`/assets/${slug}/`) || l.includes('/sets/'));
  if (stack.length) lines.push(`at ${stack[0].trim().replace(/^at /, '').replace(paths.root + path.sep, '')}`);
  return lines.join('\n');
}
