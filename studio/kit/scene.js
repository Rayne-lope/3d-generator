// Asset scene structure: asset root → parts → meshes.
//
// - Non-separate parts are only for organization; at export their meshes are merged
//   (per material) into the nearest separate ancestor, or into the asset body.
// - Separate parts ({ separate: true }) become their own glTF node, with the node origin
//   at `pivot` (in asset space). Use them for things that move or detach: lids, doors,
//   wheels, drawers. Author the part's meshes in asset coordinates; rotating the part
//   rotates around the pivot.

import * as THREE from 'three';

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;

function checkName(name, what) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`${what}: invalid name ${JSON.stringify(name)} (letters, digits, '_' or '-', start with a letter, max 63 chars)`);
  }
}

/** The asset root. Add parts or meshes to it and return it from build(). */
export function asset(name = 'asset') {
  checkName(name, 'k.asset');
  const g = new THREE.Group();
  g.name = name;
  g.userData.studio = { role: 'asset' };
  return g;
}

/**
 * A named part.
 * @param {string} name
 * @param {{separate?: boolean, pivot?: number[]}} [opts]
 */
export function part(name, opts = {}) {
  checkName(name, 'k.part');
  const { separate = false, pivot = null } = opts;
  if (pivot && !separate) throw new Error(`k.part('${name}'): pivot only makes sense with separate: true`);
  const outer = new THREE.Group();
  outer.name = name;
  outer.userData.studio = { role: 'part', separate: !!separate, pivot: pivot ? [pivot[0], pivot[1], pivot[2]] : null };
  if (pivot) {
    outer.position.set(pivot[0], pivot[1], pivot[2]);
    const inner = new THREE.Group();
    inner.name = `${name}__content`;
    inner.position.set(-pivot[0], -pivot[1], -pivot[2]);
    inner.userData.studio = { role: 'pivot-offset' };
    THREE.Object3D.prototype.add.call(outer, inner);
    // Children are authored in asset space; route them through the pivot offset.
    outer.add = (...objects) => {
      inner.add(...objects);
      return outer;
    };
  }
  return outer;
}

/**
 * A mesh with a kit material.
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.MeshStandardMaterial} material
 * @param {{name?: string, at?: number[], rot?: number[], scale?: number|number[]}} [opts]
 */
export function mesh(geometry, material, opts = {}) {
  if (!geometry?.isBufferGeometry) throw new Error('k.mesh: first argument must be a BufferGeometry (from k.geo.*)');
  if (!material?.isMeshStandardMaterial || !material.userData?.studio?.kitMaterial) {
    throw new Error('k.mesh: material must come from k.mat.pbr() or k.mat.physical()');
  }
  if (!geometry.attributes.position) throw new Error('k.mesh: geometry has no position attribute');
  const m = new THREE.Mesh(geometry, material);
  m.name = opts.name || material.name || 'mesh';
  if (opts.at) m.position.set(opts.at[0], opts.at[1], opts.at[2]);
  if (opts.rot) m.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  if (opts.scale !== undefined) {
    if (typeof opts.scale === 'number') m.scale.setScalar(opts.scale);
    else m.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
    if (m.scale.x * m.scale.y * m.scale.z < 0) {
      throw new Error('k.mesh: negative scale is not allowed (it flips faces in engines). Use k.op.mirror(geometry, axis) instead.');
    }
  }
  return m;
}

/** A plain group for arranging meshes (merged at export like a non-separate part). */
export function group(name = 'group') {
  const g = new THREE.Group();
  g.name = name;
  return g;
}

/**
 * Copies of an object placed around the Y axis.
 * fn(i, angle) returns an Object3D positioned as if at angle 0 on +X; it is rotated into place.
 */
export function ring(count, radius, fn) {
  const g = new THREE.Group();
  g.name = 'ring';
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const obj = fn(i, angle);
    const holder = new THREE.Group();
    holder.rotation.y = -angle;
    obj.position.x += radius;
    holder.add(obj);
    g.add(holder);
  }
  return g;
}
