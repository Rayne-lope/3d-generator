// Markers: things an engine needs that are not geometry.
//  - attachments: named points with an orientation (grip, muzzle, magazine well, lamp socket)
//  - colliders:   simple collision shapes (box, sphere, cylinder) instead of the visual mesh
// A marker is an empty object in the asset scene, so it moves with the part it is added to,
// with pivots, with the asset origin and with editor transforms. Nothing is rendered or
// exported as a mesh: the exporter writes markers as data (see docs/KIT.md).

import * as THREE from 'three';

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;

function vec3(value, what) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error(`${what} must be [x, y, z] (finite numbers)`);
  }
  return value;
}

function positive(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${what} must be a number > 0`);
  return value;
}

/**
 * A named attachment point. Its local +Z points along `forward` and its +Y along `up`
 * (made perpendicular to forward). Engines read `forward` as the direction the attached
 * thing points: a muzzle's forward is the shooting direction.
 * @param {string} name e.g. 'grip', 'muzzle', 'magwell'
 * @param {{at?: number[], forward?: number[], up?: number[]}} [opts] in the space of the part it is added to (meters)
 */
export function attach(name, opts = {}) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error(`k.attach: invalid name ${JSON.stringify(name)} (letters, digits, '_' or '-', start with a letter)`);
  const at = vec3(opts.at ?? [0, 0, 0], `k.attach('${name}'): at`);
  const f = new THREE.Vector3(...vec3(opts.forward ?? [0, 0, 1], `k.attach('${name}'): forward`));
  const u = new THREE.Vector3(...vec3(opts.up ?? [0, 1, 0], `k.attach('${name}'): up`));
  if (f.lengthSq() < 1e-12) throw new Error(`k.attach('${name}'): forward must not be [0, 0, 0]`);
  f.normalize();
  const right = new THREE.Vector3().crossVectors(u, f);
  if (right.lengthSq() < 1e-10) throw new Error(`k.attach('${name}'): up must not be parallel to forward`);
  right.normalize();
  const trueUp = new THREE.Vector3().crossVectors(f, right).normalize();
  const marker = new THREE.Object3D();
  marker.name = name;
  marker.position.set(at[0], at[1], at[2]);
  marker.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, trueUp, f));
  marker.userData.studio = { role: 'attachment' };
  return marker;
}

function colliderMarker(shape, size, opts, what) {
  const at = vec3(opts.at ?? [0, 0, 0], `${what}: at`);
  const marker = new THREE.Object3D();
  if (opts.name !== undefined && (typeof opts.name !== 'string' || !NAME_RE.test(opts.name))) throw new Error(`${what}: invalid name ${JSON.stringify(opts.name)}`);
  marker.name = opts.name || 'collider';
  marker.position.set(at[0], at[1], at[2]);
  if (opts.rot) {
    const rot = vec3(opts.rot, `${what}: rot`);
    marker.rotation.set(rot[0], rot[1], rot[2]);
  }
  marker.userData.studio = { role: 'collider', shape, size, named: !!opts.name };
  return marker;
}

/** Collision shapes, centered on `at`. Use a few of them instead of the visual mesh. */
export const collider = {
  /** Box of width (x) × height (y) × depth (z) meters. `rot` = Euler XYZ radians. */
  box(w, h, d, opts = {}) {
    return colliderMarker('box', [positive(w, 'k.collider.box: width'), positive(h, 'k.collider.box: height'), positive(d, 'k.collider.box: depth')], opts, 'k.collider.box');
  },
  /** Sphere of radius r meters. */
  sphere(r, opts = {}) {
    return colliderMarker('sphere', [positive(r, 'k.collider.sphere: radius')], opts, 'k.collider.sphere');
  },
  /** Cylinder of radius r and height h meters along Y (turn it with `rot`). */
  cylinder(r, h, opts = {}) {
    return colliderMarker('cylinder', [positive(r, 'k.collider.cylinder: radius'), positive(h, 'k.collider.cylinder: height')], opts, 'k.collider.cylinder');
  },
};
