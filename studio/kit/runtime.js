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

/** Height band (from the lowest point) that counts as the footprint an asset stands on. */
export function footprintBand(height) {
  return Math.max(height * 0.02, 0.002);
}

function forEachWorldVertex(root, fn) {
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const instances = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < instances; k++) {
      if (o.isInstancedMesh) o.getMatrixAt(k, m).premultiply(o.matrixWorld);
      else m.copy(o.matrixWorld);
      for (let i = 0; i < pos.count; i++) fn(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    }
  });
}

/**
 * Move the root so the requested origin sits at (0, 0, 0).
 * base-center: lowest point at y = 0, x/z at the center of the footprint (the vertices within
 * a thin band above the lowest point). Using the footprint instead of the whole bounding box
 * keeps the pivot where the asset stands, so a revision that grows a protruding detail
 * (a bigger lock, a longer branch) does not shift the whole asset.
 */
export function applyOrigin(root, mode = 'base-center') {
  root.updateMatrixWorld(true);
  if (mode === 'none') return;
  const box = new THREE.Box3().setFromObject(root, true);
  if (box.isEmpty()) throw new Error('the asset is empty (no meshes)');
  const c = box.getCenter(new THREE.Vector3());
  let off;
  if (mode === 'center') off = c;
  else if (mode === 'back-center') off = new THREE.Vector3(c.x, box.min.y, box.min.z);
  else {
    const limit = box.min.y + footprintBand(box.max.y - box.min.y);
    const foot = new THREE.Box3();
    forEachWorldVertex(root, (v) => {
      if (v.y <= limit) foot.expandByPoint(v);
    });
    const fc = foot.isEmpty() ? c : foot.getCenter(new THREE.Vector3());
    off = new THREE.Vector3(fc.x, box.min.y, fc.z);
  }
  root.position.sub(off);
  root.updateMatrixWorld(true);
}
