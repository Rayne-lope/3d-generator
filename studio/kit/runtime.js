// Runs an asset definition the same way in Node (export) and the browser (parity render).

import * as THREE from 'three';
import { k } from './k.js';
import { createRng } from './rng.js';
import { createNoise } from './noise.js';

/**
 * @param {any} def asset definition (default export of an asset module)
 * @param {{variant?: string|null, params?: object}} [opts]
 */
export function runAsset(def, { variant = null, params: overrides = {} } = {}) {
  if (!def || !def.__studioAsset) throw new Error('asset module must `export default defineAsset({...})`');
  let p = { ...def.params };
  let seed = def.seed;
  if (variant) {
    const v = def.variants[variant];
    if (!v) throw new Error(`unknown variant '${variant}' (available: ${Object.keys(def.variants).join(', ') || 'none'})`);
    const { seed: vSeed, ...vParams } = v;
    p = { ...p, ...vParams };
    if (vSeed !== undefined) seed = vSeed;
  }
  p = Object.freeze({ ...p, ...overrides });
  const rng = createRng(seed);
  const noise = createNoise(seed);
  const root = def.build({ p, k, rng, noise, THREE, variant });
  if (!root || !root.isObject3D) throw new Error('build() must return the asset root (k.asset())');
  applyOrigin(root, def.meta.origin);
  root.updateMatrixWorld(true);
  return { root, params: p, seed, meta: def.meta, variant };
}

/** Move the root so the requested origin sits at (0, 0, 0). */
export function applyOrigin(root, mode = 'base-center') {
  root.updateMatrixWorld(true);
  if (mode === 'none') return;
  const box = new THREE.Box3().setFromObject(root, true);
  if (box.isEmpty()) throw new Error('the asset is empty (no meshes)');
  const c = box.getCenter(new THREE.Vector3());
  let off;
  if (mode === 'center') off = c;
  else if (mode === 'back-center') off = new THREE.Vector3(c.x, box.min.y, box.min.z);
  else off = new THREE.Vector3(c.x, box.min.y, c.z);
  root.position.sub(off);
  root.updateMatrixWorld(true);
}
