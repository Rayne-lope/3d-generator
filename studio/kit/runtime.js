// Runs an asset definition the same way in Node (export) and the browser (parity render).

import * as THREE from 'three';
import { k } from './k.js';
import { createRng } from './rng.js';
import { createNoise } from './noise.js';
import { resetPainterNames } from './texture.js';
import { editorParams, editorParts, partTransformState, validateEditorState } from './editor.js';

/**
 * Params merge in this order: defaults ← variant ← skin ← explicit overrides.
 * @param {any} def asset definition (default export of an asset module)
 * @param {{variant?: string|null, skin?: string|null, params?: object}} [opts]
 */
export function runAsset(def, { variant = null, skin = null, params: overrides = {}, editor = null } = {}) {
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
  if (skin) {
    const skins = def.skins || {};
    const s = skins[skin];
    if (!s) throw new Error(`unknown skin '${skin}' (available: ${Object.keys(skins).join(', ') || 'none'})`);
    p = { ...p, ...s };
  }
  p = Object.freeze(editor ? editorParams(def, validateEditorState(def, editor), variant, skin, overrides) : { ...p, ...overrides });
  const rng = createRng(seed);
  const noise = createNoise(seed);
  // Unnamed painters are numbered per build, so a build gives the same bytes whatever ran before it.
  resetPainterNames();
  const root = def.build({ p, k, rng, noise, THREE, variant, skin });
  if (!root || !root.isObject3D) throw new Error('build() must return the asset root (k.asset())');
  applyOrigin(root, def.meta.origin);
  const parts = applyPartTransforms(root, def, editor, variant);
  root.updateMatrixWorld(true);
  return { root, params: p, seed, meta: def.meta, variant, skin, parts };
}

function poseOf(object) {
  return {
    position: object.position.toArray(), rotation: object.quaternion.toArray(), scale: object.scale.toArray(),
    worldMatrix: object.matrixWorld.toArray(),
  };
}

function hasShearOrNonuniform(matrix) {
  const e = matrix.elements;
  const a = new THREE.Vector3(e[0], e[1], e[2]);
  const b = new THREE.Vector3(e[4], e[5], e[6]);
  const c = new THREE.Vector3(e[8], e[9], e[10]);
  const lengths = [a.length(), b.length(), c.length()];
  if (lengths.some((n) => !Number.isFinite(n) || n < 1e-8)) return true;
  return Math.max(...lengths) - Math.min(...lengths) > 1e-5 ||
    Math.abs(a.dot(b)) > 1e-5 || Math.abs(a.dot(c)) > 1e-5 || Math.abs(b.dot(c)) > 1e-5;
}

/** Apply persisted local deltas to authored separate parts after origin normalization. */
export function applyPartTransforms(root, def, editor = null, variant = null) {
  root.updateMatrixWorld(true);
  const catalog = new Map(editorParts(def).map((part) => [part.id, part]));
  const indexed = new Map();
  const allIds = new Set();
  root.traverse((object) => {
    const studio = object.userData?.studio;
    if (!studio?.id) return;
    if (studio.role !== 'part') throw new Error(`part id '${studio.id}' requires a part`);
    if (allIds.has(studio.id)) throw new Error(`duplicate part id '${studio.id}'`);
    allIds.add(studio.id);
    if (!studio.separate) return;
    indexed.set(studio.id, object);
  });
  const transforms = partTransformState(def, editor, variant);
  const scoped = editor?.partTransforms;
  for (const id of [...Object.keys(scoped?.base || {}), ...Object.keys(variant ? scoped?.variants?.[variant] || {} : {})]) {
    if (!indexed.has(id)) throw new Error(`editable part '${id}' is absent from '${variant || 'base'}' look`);
  }
  const authored = new Map([...indexed].map(([id, object]) => [id, poseOf(object)]));
  for (const [id, object] of indexed) {
    if (!catalog.has(id)) continue;
    const delta = transforms.effective[id];
    object.position.add(new THREE.Vector3(...delta.move));
    object.quaternion.multiply(new THREE.Quaternion(...delta.rotation));
    object.scale.multiplyScalar(delta.scale);
  }
  root.updateMatrixWorld(true);
  const parts = [];
  for (const [id, object] of indexed) {
    const registered = catalog.get(id);
    let parent = object.parent;
    while (parent && !(parent.userData?.studio?.id && parent.userData.studio.separate)) parent = parent.parent;
    const unsafe = hasShearOrNonuniform(object.parent?.matrixWorld || new THREE.Matrix4()) ||
      hasShearOrNonuniform(new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion(), object.scale));
    const bounds = new THREE.Box3().setFromObject(object, true);
    parts.push({ id, name: object.name, label: registered?.label || object.name, parentPartId: parent?.userData?.studio?.id || null,
      pivot: object.userData.studio.pivot || null, authored: authored.get(id), effective: poseOf(object),
      delta: transforms.effective[id] || null,
      parentWorldMatrix: object.parent?.matrixWorld.toArray() || new THREE.Matrix4().toArray(),
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      editable: !!registered && !unsafe && !!object.userData.studio.pivot,
      reason: !registered ? 'Part is not enabled for transforms' : !object.userData.studio.pivot ? 'Part has no authored pivot' : unsafe ? 'Nonuniform or sheared ancestor transform' : null,
    });
  }
  return parts;
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
