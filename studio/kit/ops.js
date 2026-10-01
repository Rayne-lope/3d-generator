// Geometry operators. Every op returns a geometry — always use the return value,
// it may be a new object. Kit geometries are non-indexed with position/normal/uv.
// The exporter welds identical vertices later, so non-indexed costs nothing in the GLB.

import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise } from './noise.js';
import { createRng } from './rng.js';

const DEG = Math.PI / 180;

export function nonIndexed(g) {
  if (!g.index) return g;
  const out = g.toNonIndexed();
  out.userData = { ...g.userData };
  return out;
}

/** Make sure normal and uv attributes exist. */
export function ensureAttributes(g) {
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  return g;
}

export function setShading(g, mode, angle = 30) {
  g.userData.shading = { mode, angle };
  return g;
}

/** Faceted normals (one normal per triangle). */
export function flat(g) {
  const out = nonIndexed(g);
  out.deleteAttribute('normal');
  out.computeVertexNormals();
  return setShading(out, 'flat', 0);
}

/** Smooth normals except across edges sharper than angleDeg. The main shading tool. */
export function crease(g, angleDeg = 30) {
  const src = nonIndexed(g);
  // three's toCreasedNormals welds positions on a 1 cm grid; scale small geometry up first
  // so tiny details (rivets, bolts) keep correct normals. Uniform scale keeps normal directions.
  src.computeBoundingSphere();
  const r = src.boundingSphere?.radius || 1;
  const s = r < 50 ? 100 / Math.max(r, 1e-6) : 1;
  if (s !== 1) src.scale(s, s, s);
  const out = toCreasedNormals(src, angleDeg * DEG);
  if (s !== 1) out.scale(1 / s, 1 / s, 1 / s);
  out.userData = { ...g.userData };
  return setShading(out, angleDeg >= 179 ? 'smooth' : 'crease', angleDeg);
}

/** Fully smooth normals (shared positions share one normal). */
export function smooth(g) {
  return crease(g, 180);
}

/** Recompute normals with the geometry's recorded shading mode (after deforming). */
export function reshade(g) {
  const s = g.userData.shading || { mode: 'crease', angle: 30 };
  if (s.mode === 'flat') return flat(g);
  if (s.mode === 'smooth') return smooth(g);
  return crease(g, s.angle ?? 30);
}

export function clone(g) {
  const out = g.clone();
  out.userData = { ...g.userData };
  return out;
}

/** Swap triangle winding (keeps normals). */
export function flipWinding(g) {
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.index.needsUpdate = true;
    return g;
  }
  for (const name of Object.keys(g.attributes)) {
    const attr = g.attributes[name];
    const n = attr.itemSize;
    const arr = attr.array;
    for (let v = 0; v < attr.count; v += 3) {
      const b = (v + 1) * n;
      const c = (v + 2) * n;
      for (let k = 0; k < n; k++) {
        const t = arr[b + k];
        arr[b + k] = arr[c + k];
        arr[c + k] = t;
      }
    }
    attr.needsUpdate = true;
  }
  return g;
}

export function translate(g, x = 0, y = 0, z = 0) {
  g.translate(x, y, z);
  return g;
}

/** Rotate by Euler angles in radians (XYZ order). */
export function rotate(g, x = 0, y = 0, z = 0) {
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ')));
  return g;
}

/** Scale; negative factors are mirrored safely (winding is fixed). */
export function scale(g, x, y = x, z = x) {
  g.scale(x, y, z);
  if (x * y * z < 0) flipWinding(g);
  return g;
}

/** Apply a Matrix4; a negative determinant is mirrored safely. */
export function transform(g, matrix) {
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) flipWinding(g);
  return g;
}

/**
 * Lay geometry built around the Y axis (lathe, cylinder, tube rings) along X or Z.
 * The lathe's phi = 0 side (+Z) ends up on top (+Y), so a partial lathe centered on
 * phi = 0 becomes an upward arc: barrel-vault lids, logs, horizontal pipes, arches.
 * 'x': (x, y, z) → (y, z, x)   'z': (x, y, z) → (-x, z, y)   (pure rotations)
 */
export function lieAlong(g, axis = 'x') {
  const m = new THREE.Matrix4();
  if (axis === 'x') m.set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  else if (axis === 'z') m.set(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  else throw new Error("k.op.lieAlong: axis must be 'x' or 'z'");
  g.applyMatrix4(m);
  return g;
}

/** Mirrored copy across an axis plane through the origin ('x' mirrors x → -x). */
export function mirror(g, axis = 'x') {
  const out = clone(g);
  return scale(out, axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1);
}

/** Merge geometries into one (they keep their own normals and UVs). */
export function merge(...geometries) {
  const list = geometries.flat().filter(Boolean);
  if (!list.length) throw new Error('k.op.merge: nothing to merge');
  const cleaned = list.map((g) => {
    const src = ensureAttributes(nonIndexed(g));
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', src.attributes.position);
    c.setAttribute('normal', src.attributes.normal);
    c.setAttribute('uv', src.attributes.uv);
    return c;
  });
  const out = mergeGeometries(cleaned, false);
  if (!out) throw new Error('k.op.merge: failed to merge geometries');
  out.userData = { shading: list[0].userData.shading || { mode: 'crease', angle: 30 } };
  return out;
}

export function bounds(g) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  return { min: b.min.clone(), max: b.max.clone(), size: b.getSize(new THREE.Vector3()), center: b.getCenter(new THREE.Vector3()) };
}

/** Center on the origin. y: 'center' | 'base' (bottom at y = 0) | 'top'. */
export function center(g, { y = 'center', x = true, z = true } = {}) {
  const b = bounds(g);
  const dx = x ? -b.center.x : 0;
  const dz = z ? -b.center.z : 0;
  const dy = y === 'base' ? -b.min.y : y === 'top' ? -b.max.y : y === 'center' ? -b.center.y : 0;
  g.translate(dx, dy, dz);
  return g;
}

/** Move so the bottom sits at y = 0. */
export function sit(g) {
  const b = bounds(g);
  g.translate(0, -b.min.y, 0);
  return g;
}

const AXES = { x: 0, y: 1, z: 2 };

function axisIndex(axis) {
  const i = AXES[axis];
  if (i === undefined) throw new Error(`axis must be 'x', 'y' or 'z' (got ${axis})`);
  return i;
}

/** Position-keyed smooth normals so deformations move shared vertices identically. */
function smoothNormalsByPosition(g) {
  const pos = g.attributes.position.array;
  const map = new Map();
  const key = (i) => `${Math.round(pos[i] * 1e4)},${Math.round(pos[i + 1] * 1e4)},${Math.round(pos[i + 2] * 1e4)}`;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const count = g.attributes.position.count;
  for (let v = 0; v + 2 < count; v += 3) {
    a.fromArray(pos, v * 3);
    b.fromArray(pos, v * 3 + 3);
    c.fromArray(pos, v * 3 + 6);
    n.subVectors(c, b).cross(a.clone().sub(b));
    for (let k = 0; k < 3; k++) {
      const kk = key((v + k) * 3);
      const acc = map.get(kk) || new THREE.Vector3();
      acc.add(n);
      map.set(kk, acc);
    }
  }
  for (const v of map.values()) v.normalize();
  return { map, key };
}

/**
 * Displace vertices. fn(position, smoothNormal) returns a number (offset along the
 * normal) or a THREE.Vector3 offset. Vertices sharing a position move together (no cracks).
 */
export function displace(g, fn) {
  const out = nonIndexed(g);
  const pos = out.attributes.position.array;
  const { map, key } = smoothNormalsByPosition(out);
  const cache = new Map();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    const kk = key(i);
    let off = cache.get(kk);
    if (!off) {
      p.set(pos[i], pos[i + 1], pos[i + 2]);
      const nrm = map.get(kk) || new THREE.Vector3(0, 1, 0);
      const r = fn(p.clone(), nrm.clone());
      off = typeof r === 'number' ? nrm.clone().multiplyScalar(r) : r || new THREE.Vector3();
      cache.set(kk, off);
    }
    pos[i] += off.x;
    pos[i + 1] += off.y;
    pos[i + 2] += off.z;
  }
  out.attributes.position.needsUpdate = true;
  return reshade(out);
}

/** Organic noise displacement along smooth normals. */
export function noise(g, { amount = 0.02, scale: freq = 4, octaves = 3, seed = 1, ridged = false } = {}) {
  const n = createNoise(seed);
  return displace(g, (p) => {
    const v = ridged ? n.ridged3(p.x * freq, p.y * freq, p.z * freq, { octaves }) - 0.5 : n.fbm3(p.x * freq, p.y * freq, p.z * freq, { octaves });
    return v * amount;
  });
}

/** Random per-position jitter (hand-made imperfection). */
export function jitter(g, { amount = 0.004, seed = 1 } = {}) {
  const rng = createRng(seed);
  const cache = new Map();
  return displace(g, (p) => {
    const k = `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
    if (!cache.has(k)) cache.set(k, new THREE.Vector3(rng.jitter(amount), rng.jitter(amount), rng.jitter(amount)));
    return cache.get(k).clone();
  });
}

/** Push a dent into the surface around `at` (asset/geometry space). */
export function dent(g, { at, radius = 0.1, depth = 0.02 } = {}) {
  const c = new THREE.Vector3(at[0], at[1], at[2]);
  return displace(g, (p) => {
    const d = p.distanceTo(c) / radius;
    if (d >= 1) return 0;
    return -depth * (1 - d * d) ** 2;
  });
}

/** Scale the cross-section along an axis from `from` (at min) to `to` (at max). */
export function taper(g, { axis = 'y', from = 1, to = 0.7, curve = 1 } = {}) {
  const out = nonIndexed(g);
  const ai = axisIndex(axis);
  const b = bounds(out);
  const min = b.min.getComponent(ai);
  const span = Math.max(1e-9, b.max.getComponent(ai) - min);
  const pos = out.attributes.position.array;
  for (let i = 0; i < pos.length; i += 3) {
    const t = Math.pow((pos[i + ai] - min) / span, curve);
    const s = from + (to - from) * t;
    for (let k = 0; k < 3; k++) if (k !== ai) pos[i + k] *= s;
  }
  out.attributes.position.needsUpdate = true;
  return reshade(out);
}

/** Barrel-style bulge: the cross-section grows by `amount` (fraction) at the middle of the axis. */
export function bulge(g, { axis = 'y', amount = 0.1, power = 2 } = {}) {
  const out = nonIndexed(g);
  const ai = axisIndex(axis);
  const b = bounds(out);
  const min = b.min.getComponent(ai);
  const span = Math.max(1e-9, b.max.getComponent(ai) - min);
  const pos = out.attributes.position.array;
  for (let i = 0; i < pos.length; i += 3) {
    const t = (pos[i + ai] - min) / span;
    const s = 1 + amount * (1 - Math.pow(Math.abs(2 * t - 1), power));
    for (let k = 0; k < 3; k++) if (k !== ai) pos[i + k] *= s;
  }
  out.attributes.position.needsUpdate = true;
  return reshade(out);
}

/** Twist around an axis by `angle` radians over the geometry's extent. */
export function twist(g, { axis = 'y', angle = Math.PI / 4 } = {}) {
  const out = nonIndexed(g);
  const ai = axisIndex(axis);
  const b = bounds(out);
  const min = b.min.getComponent(ai);
  const span = Math.max(1e-9, b.max.getComponent(ai) - min);
  const pos = out.attributes.position.array;
  const [u, v] = [0, 1, 2].filter((k) => k !== ai);
  for (let i = 0; i < pos.length; i += 3) {
    const a = ((pos[i + ai] - min) / span) * angle;
    const cu = pos[i + u];
    const cv = pos[i + v];
    pos[i + u] = cu * Math.cos(a) - cv * Math.sin(a);
    pos[i + v] = cu * Math.sin(a) + cv * Math.cos(a);
  }
  out.attributes.position.needsUpdate = true;
  return reshade(out);
}

/**
 * Bend along `axis` toward `toward` by `angle` radians (circular arc), keeping the
 * minimum end in place. E.g. bend(g, { axis: 'y', toward: 'x', angle: 0.4 }) leans a post.
 */
export function bend(g, { axis = 'y', toward = 'x', angle = 0.3 } = {}) {
  if (Math.abs(angle) < 1e-6) return g;
  const out = nonIndexed(g);
  const ai = axisIndex(axis);
  const ti = axisIndex(toward);
  if (ai === ti) throw new Error('k.op.bend: axis and toward must differ');
  const b = bounds(out);
  const min = b.min.getComponent(ai);
  const span = Math.max(1e-9, b.max.getComponent(ai) - min);
  const radius = span / angle;
  const pos = out.attributes.position.array;
  for (let i = 0; i < pos.length; i += 3) {
    const along = pos[i + ai] - min;
    const off = pos[i + ti];
    const theta = along / radius;
    const r = radius - off;
    pos[i + ai] = min + r * Math.sin(theta);
    pos[i + ti] = radius - r * Math.cos(theta);
  }
  out.attributes.position.needsUpdate = true;
  return reshade(out);
}

/** Drop triangles whose centroid fails the predicate (e.g. hidden bottom faces). */
export function keepFaces(g, predicate) {
  const src = nonIndexed(g);
  const attrs = Object.keys(src.attributes);
  const keep = [];
  const pos = src.attributes.position.array;
  const c = new THREE.Vector3();
  for (let v = 0; v < src.attributes.position.count; v += 3) {
    c.set(
      (pos[v * 3] + pos[v * 3 + 3] + pos[v * 3 + 6]) / 3,
      (pos[v * 3 + 1] + pos[v * 3 + 4] + pos[v * 3 + 7]) / 3,
      (pos[v * 3 + 2] + pos[v * 3 + 5] + pos[v * 3 + 8]) / 3,
    );
    if (predicate(c.clone())) keep.push(v);
  }
  const out = new THREE.BufferGeometry();
  for (const name of attrs) {
    const a = src.attributes[name];
    const arr = new Float32Array(keep.length * 3 * a.itemSize);
    let o = 0;
    for (const v of keep) {
      for (let k = 0; k < 3 * a.itemSize; k++) arr[o++] = a.array[v * a.itemSize + k];
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.userData = { ...src.userData };
  return out;
}
