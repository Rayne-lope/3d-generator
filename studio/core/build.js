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

export function computeSourceHash(slug, variant, profileId, setName) {
  return hashDirs([...sourceDirsFor(slug, setName), ...PIPELINE_DIRS], `${KIT_VERSION}|${profileId}|${variant || ''}`);
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
 * @param {{slug: string, variant?: string|null, profileId?: string, write?: boolean, force?: boolean, allowDecimate?: boolean}} opts
 * @returns {Promise<{glb: Uint8Array, report: any, cached: boolean, info?: any, ir?: any}>}
 */
export async function buildItem({ slug, variant = null, profileId = 'generic', write = true, force = false, allowDecimate = false }) {
  const t0 = performance.now();
  const profile = loadProfile(profileId);
  const def = await loadAssetDef(slug);
  const setName = def.meta.set || setOfAsset(slug);
  const sourceHash = computeSourceHash(slug, variant, profileId, setName) + (allowDecimate ? ':dec' : '');
  const glbFile = previewGlb(slug, variant, profileId);
  const reportFile = previewReport(slug, variant, profileId);
  if (!force && write && fs.existsSync(glbFile) && fs.existsSync(reportFile)) {
    const prev = readJson(reportFile, null);
    if (prev && prev.hashes?.source === sourceHash) {
      return { glb: new Uint8Array(fs.readFileSync(glbFile)), report: prev, cached: true };
    }
  }
  const run = runAsset(def, { variant });
  const ir = sceneToIR(run.root, { slug, variant, meta: def.meta });
  await applyProfile(ir, profile, { allowDecimate });
  const { glb } = await irToGLB(ir, {
    profileId,
    allowEmissiveStrength: profile.materials.emissiveStrength,
    extras: { title: def.meta.title, sourceHash, kit: KIT_VERSION },
  });
  const info = await inspectGLB(glb);
  const sourceFiles = sourceDirsFor(slug, setName).flatMap((dir) => listFiles(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f)));
  const validation = await validate({ glb, info, ir, profile, meta: def.meta, sourceFiles });
  const glbHash = sha256(glb);
  const report = makeReport({
    slug, variant, id: itemId(slug, variant), def, setName, profile, glbPath: rel(glbFile), glbBytes: glb.byteLength, glbHash,
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
