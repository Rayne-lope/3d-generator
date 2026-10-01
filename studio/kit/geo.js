// Geometry primitives. All return non-indexed BufferGeometry with position, normal and
// world-scale uv (1 UV unit = 1 meter × uvScale), centered on the origin unless
// `base: true` (bottom at y = 0). Units are meters; +Y is up; the asset front faces +Z.

import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createNoise } from './noise.js';
import { createRng } from './rng.js';
import { bend, crease, flat, jitter, nonIndexed, setShading, smooth, flipWinding } from './ops.js';
import { box as boxUV, planar as planarUV } from './uv.js';

const TAU = Math.PI * 2;

/** Remove zero-area triangles (e.g. collapsed poles of three.js generators). */
function dropDegenerate(g) {
  const pos = g.attributes.position;
  const keep = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < pos.count; t += 3) {
    a.fromBufferAttribute(pos, t);
    b.fromBufferAttribute(pos, t + 1);
    c.fromBufferAttribute(pos, t + 2);
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() > 1e-20) keep.push(t);
  }
  if (keep.length * 3 === pos.count) return g;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const attr = g.attributes[name];
    const arr = new Float32Array(keep.length * 3 * attr.itemSize);
    let o = 0;
    for (const t of keep) {
      for (let k = 0; k < 3 * attr.itemSize; k++) arr[o++] = attr.array[t * attr.itemSize + k];
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
  }
  out.userData = { ...g.userData };
  return out;
}

function finish(geometry, { base = false } = {}) {
  const g = geometry.index ? geometry : dropDegenerate(geometry);
  if (base) {
    g.computeBoundingBox();
    g.translate(0, -g.boundingBox.min.y, 0);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Flip V of three.js generator UVs so that image top = geometric top (glTF convention). */
function flipV(g) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;
  return g;
}

function scaleUVs(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

/**
 * Box. bevel > 0 gives chamfered (flat) edges that catch light; smooth: true rounds them.
 * @param {number} w @param {number} h @param {number} d
 * @param {{bevel?: number, smooth?: boolean, segments?: number, uvScale?: number, base?: boolean}} [opts]
 */
export function box(w, h, d, opts = {}) {
  const { bevel = 0, smooth: round = false, segments = 3, uvScale = 1, base = false } = opts;
  const b = Math.max(0, Math.min(bevel, w * 0.49, h * 0.49, d * 0.49));
  let g;
  if (b <= 1e-6) {
    g = nonIndexed(new THREE.BoxGeometry(w, h, d));
    g = boxUV(g, { scale: uvScale });
    g = flat(g);
  } else if (round) {
    g = nonIndexed(new RoundedBoxGeometry(w, h, d, segments, b));
    g = boxUV(g, { scale: uvScale });
    g = crease(g, 50);
  } else {
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const pts = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          pts.push(new THREE.Vector3(sx * (hw - b), sy * (hh - b), sz * hd));
          pts.push(new THREE.Vector3(sx * (hw - b), sy * hh, sz * (hd - b)));
          pts.push(new THREE.Vector3(sx * hw, sy * (hh - b), sz * (hd - b)));
        }
      }
    }
    g = new ConvexGeometry(pts);
    g = boxUV(g, { scale: uvScale });
    g = flat(g);
  }
  return finish(g, { base });
}

/**
 * Surface of revolution around Y. profile: [[radius, y], ...] from bottom to top.
 * Start/end at radius 0 to close the caps. crease: angle (deg) above which edges stay sharp.
 */
export function lathe(profile, opts = {}) {
  const { segments = 24, uvScale = 1, crease: creaseAngle = 40, flat: faceted = false, phiStart = 0, phiLength = TAU, closed = false } = opts;
  const pts = profile.map(([r, y]) => [Math.max(0, r), y]);
  if (closed) pts.push(pts[0]);
  if (pts.length < 2) throw new Error('k.geo.lathe: profile needs at least 2 points');
  const n = pts.length;
  const lengths = [0];
  for (let i = 1; i < n; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lengths[n - 1];
  const rRef = Math.max(...pts.map((p) => p[0])) || 1;
  const positions = [];
  const uvs = [];
  const vert = (j, i) => {
    const phi = phiStart + (j / segments) * phiLength;
    const [r, y] = pts[i];
    return { p: [r * Math.sin(phi), y, r * Math.cos(phi)], uv: [phi * rRef * uvScale, (total - lengths[i]) * uvScale] };
  };
  const push = (...vs) => {
    for (const v of vs) {
      positions.push(...v.p);
      uvs.push(...v.uv);
    }
  };
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = vert(j, i);
      const b = vert(j + 1, i);
      const c = vert(j + 1, i + 1);
      const d = vert(j, i + 1);
      if (pts[i][0] > 1e-9) push(a, b, c);
      if (pts[i + 1][0] > 1e-9) push(a, c, d);
    }
  }
  // Side caps for partial revolutions (staves, wedges): close the profile at both ends.
  const partial = phiLength < TAU - 1e-6;
  const touchesAxis = pts[0][0] <= 1e-9 && pts[n - 1][0] <= 1e-9;
  if (partial && (closed || touchesAxis) && opts.capSides !== false) {
    const contour = (closed ? pts.slice(0, -1) : pts).map(([r, y]) => new THREE.Vector2(r, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [phi, sign] of [[phiStart, -1], [phiStart + phiLength, 1]]) {
      const tangent = new THREE.Vector3(Math.cos(phi), 0, -Math.sin(phi)).multiplyScalar(sign);
      for (const [ia, ib, ic] of tris) {
        const P = [ia, ib, ic].map((idx) => new THREE.Vector3(contour[idx].x * Math.sin(phi), contour[idx].y, contour[idx].x * Math.cos(phi)));
        const nrm = new THREE.Vector3().subVectors(P[1], P[0]).cross(new THREE.Vector3().subVectors(P[2], P[0]));
        const order = nrm.dot(tangent) >= 0 ? [0, 1, 2] : [0, 2, 1];
        for (const k of order) {
          positions.push(P[k].x, P[k].y, P[k].z);
          uvs.push(contour[[ia, ib, ic][k]].x * uvScale, -contour[[ia, ib, ic][k]].y * uvScale);
        }
      }
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // Caps: planar UVs on near-horizontal triangles.
  const pos = g.attributes.position.array;
  const uv = g.attributes.uv.array;
  for (let v = 0; v < pos.length / 3; v += 3) {
    const ax = pos[v * 3]; const ay = pos[v * 3 + 1]; const az = pos[v * 3 + 2];
    const ux = pos[v * 3 + 3] - ax; const uy = pos[v * 3 + 4] - ay; const uz = pos[v * 3 + 5] - az;
    const wx = pos[v * 3 + 6] - ax; const wy = pos[v * 3 + 7] - ay; const wz = pos[v * 3 + 8] - az;
    const nx = uy * wz - uz * wy; const ny = uz * wx - ux * wz; const nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    if (Math.abs(ny / len) > 0.85) {
      for (let k = 0; k < 3; k++) {
        uv[(v + k) * 2] = pos[(v + k) * 3] * uvScale;
        uv[(v + k) * 2 + 1] = (ny > 0 ? 1 : -1) * pos[(v + k) * 3 + 2] * uvScale;
      }
    }
  }
  g = faceted ? flat(g) : crease(g, creaseAngle);
  return finish(g);
}

/**
 * Cylinder (or truncated cone) with optional bevelled cap edges.
 * @param {number} radius @param {number} height
 * @param {{radiusTop?: number, segments?: number, bevel?: number, bevelSegments?: number, caps?: boolean, base?: boolean, uvScale?: number, crease?: number, flat?: boolean}} [opts]
 */
export function cylinder(radius, height, opts = {}) {
  const { radiusTop = radius, segments = 24, bevel = 0, bevelSegments = 1, caps = true, base = false, uvScale = 1, crease: creaseAngle = 40, flat: faceted = false } = opts;
  const y0 = -height / 2;
  const y1 = height / 2;
  const bb = Math.max(0, Math.min(bevel, radius * 0.5, height * 0.45));
  const bt = radiusTop > 0 ? Math.max(0, Math.min(bevel, radiusTop * 0.5, height * 0.45)) : 0;
  const profile = [];
  if (caps) profile.push([0, y0]);
  if (bb > 0) {
    for (let k = 0; k <= bevelSegments; k++) {
      const t = -Math.PI / 2 + (k / bevelSegments) * (Math.PI / 2);
      profile.push([radius - bb + bb * Math.cos(t), y0 + bb + bb * Math.sin(t)]);
    }
  } else {
    profile.push([radius, y0]);
  }
  if (radiusTop <= 0) {
    profile.push([0, y1]);
  } else {
    if (bt > 0) {
      for (let k = 0; k <= bevelSegments; k++) {
        const t = (k / bevelSegments) * (Math.PI / 2);
        profile.push([radiusTop - bt + bt * Math.cos(t), y1 - bt + bt * Math.sin(t)]);
      }
    } else {
      profile.push([radiusTop, y1]);
    }
    if (caps) profile.push([0, y1]);
  }
  const g = lathe(profile, { segments, uvScale, crease: creaseAngle, flat: faceted });
  return finish(g, { base });
}

/** Cone. */
export function cone(radius, height, opts = {}) {
  return cylinder(radius, height, { ...opts, radiusTop: 0 });
}

/** Prism with `sides` flat sides (hexagonal post, octagonal pillar...). */
export function prism(sides, radius, height, opts = {}) {
  return cylinder(radius, height, { ...opts, segments: sides, crease: Math.min(opts.crease ?? 40, (360 / sides) * 0.6) });
}

/** Flat ring with thickness (hoops, bands, washers). height is along Y. */
export function washer(rOuter, rInner, height, opts = {}) {
  const { segments = 32, bevel = 0, uvScale = 1, base = false, crease: creaseAngle = 40 } = opts;
  const h2 = height / 2;
  const b = Math.min(bevel, (rOuter - rInner) * 0.4, h2 * 0.9);
  const profile = b > 0
    ? [[rInner, -h2], [rOuter - b, -h2], [rOuter, -h2 + b], [rOuter, h2 - b], [rOuter - b, h2], [rInner, h2]]
    : [[rInner, -h2], [rOuter, -h2], [rOuter, h2], [rInner, h2]];
  const g = lathe(profile, { segments, uvScale, crease: creaseAngle, closed: true });
  return finish(g, { base });
}

/** Torus. axis 'y' = ring lying flat (hole along Y), 'z' = standing ring facing +Z. */
export function torus(R, r, opts = {}) {
  const { radialSegments = 10, tubularSegments = 32, arc = TAU, axis = 'y', uvScale = 1 } = opts;
  let g = nonIndexed(new THREE.TorusGeometry(R, r, radialSegments, tubularSegments, arc));
  flipV(g);
  scaleUVs(g, TAU * R * uvScale, TAU * r * uvScale);
  if (axis === 'y') g.rotateX(Math.PI / 2);
  else if (axis === 'x') g.rotateY(Math.PI / 2);
  g = smooth(g);
  return finish(g);
}

/** UV sphere. */
export function sphere(r, opts = {}) {
  const { widthSegments = 24, heightSegments = 16, flat: faceted = false, uvScale = 1, hemisphere = false, base = false } = opts;
  let g = nonIndexed(new THREE.SphereGeometry(r, widthSegments, heightSegments, 0, TAU, 0, hemisphere ? Math.PI / 2 : Math.PI));
  flipV(g);
  scaleUVs(g, TAU * r * uvScale, Math.PI * r * uvScale);
  g = faceted ? flat(g) : smooth(g);
  return finish(g, { base });
}

/** Icosphere: even triangles, faceted by default (low-poly look). */
export function icosphere(r, detail = 1, opts = {}) {
  const { flat: faceted = true, uvScale = 1, base = false } = opts;
  let g = nonIndexed(new THREE.IcosahedronGeometry(r, detail));
  g = boxUV(g, { scale: uvScale });
  g = faceted ? flat(g) : smooth(g);
  return finish(g, { base });
}

/** Capsule along Y (total height = length + 2r). */
export function capsule(r, length, opts = {}) {
  const { capSegments = 6, radialSegments = 16, uvScale = 1, base = false } = opts;
  let g = nonIndexed(new THREE.CapsuleGeometry(r, length, capSegments, radialSegments));
  flipV(g);
  scaleUVs(g, TAU * r * uvScale, (length + 2 * r) * uvScale);
  g = smooth(g);
  return finish(g, { base });
}

/**
 * Tube along a smooth curve through points [[x,y,z], ...].
 * caps: close the ends (keeps the mesh watertight).
 */
export function tube(points, radius, opts = {}) {
  const { segments = 32, radialSegments = 8, closed = false, caps = true, tension = 0.5, uvScale = 1, curveType = 'catmullrom' } = opts;
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, curveType, tension);
  const tg = new THREE.TubeGeometry(curve, segments, radius, radialSegments, closed);
  const length = curve.getLength();
  const parts = [];
  let g = nonIndexed(tg);
  scaleUVs(g, length * uvScale, TAU * radius * uvScale);
  parts.push(g);
  if (caps && !closed) {
    const posIdx = tg.attributes.position;
    for (const end of [0, segments]) {
      const center = curve.getPointAt(end === 0 ? 0 : 1);
      const tangent = curve.getTangentAt(end === 0 ? 0 : 1);
      const ring = [];
      for (let j = 0; j <= radialSegments; j++) {
        const vi = end * (radialSegments + 1) + j;
        ring.push(new THREE.Vector3(posIdx.getX(vi), posIdx.getY(vi), posIdx.getZ(vi)));
      }
      const capPos = [];
      for (let j = 0; j < radialSegments; j++) capPos.push(center, ring[j], ring[j + 1]);
      const cap = new THREE.BufferGeometry().setFromPoints(capPos);
      cap.computeVertexNormals();
      const n = new THREE.Vector3().fromBufferAttribute(cap.attributes.normal, 0);
      const outward = end === 0 ? tangent.clone().negate() : tangent;
      if (n.dot(outward) < 0) flipWinding(cap);
      cap.deleteAttribute('normal');
      parts.push(planarUV(cap, { axis: 'y', scale: uvScale }));
    }
  }
  const merged = mergeParts(parts);
  return finish(crease(merged, 60));
}

function mergeParts(parts) {
  const positions = [];
  const uvs = [];
  for (const p of parts) {
    const np = nonIndexed(p);
    positions.push(...np.attributes.position.array);
    const uv = np.attributes.uv ? np.attributes.uv.array : new Float32Array(np.attributes.position.count * 2);
    uvs.push(...uv);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/**
 * Extrude a 2D shape (k.shape.*) by `depth`.
 * axis 'z': shape in the XY plane, extruded along Z (centered). axis 'y': shape lies flat
 * (shape x → x, shape y → -z) and is extruded upward from y = 0.
 */
export function extrude(shape, depth, opts = {}) {
  const { bevel = 0, bevelSegments = 2, curveSegments = 12, axis = 'z', uvScale = 1, crease: creaseAngle = 35, base = false } = opts;
  const eg = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments,
    curveSegments: shape.userData?.curveSegments || curveSegments,
    steps: 1,
  });
  eg.clearGroups();
  let g = nonIndexed(eg);
  // World UV generator gives meters; flip v so +Y (up) is the image top.
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, -uv.getY(i) * uvScale);
  g.computeBoundingBox();
  const zMid = (g.boundingBox.min.z + g.boundingBox.max.z) / 2;
  if (axis === 'y') {
    g.translate(0, 0, -g.boundingBox.min.z);
    g.rotateX(-Math.PI / 2);
  } else {
    g.translate(0, 0, -zMid);
    if (axis === 'x') g.rotateY(Math.PI / 2);
  }
  g = boxUV(g, { scale: uvScale });
  g = crease(g, creaseAngle);
  return finish(g, { base });
}

/** Ramp: rectangle w×d at the bottom, rising to height h at the back (-Z). */
export function wedge(w, h, d, opts = {}) {
  const { uvScale = 1, base = false } = opts;
  const pts = [
    [-w / 2, -h / 2, -d / 2], [w / 2, -h / 2, -d / 2], [-w / 2, -h / 2, d / 2], [w / 2, -h / 2, d / 2],
    [-w / 2, h / 2, -d / 2], [w / 2, h / 2, -d / 2],
  ].map((p) => new THREE.Vector3(...p));
  let g = new ConvexGeometry(pts);
  g = boxUV(g, { scale: uvScale });
  return finish(flat(g), { base });
}

/** Horizontal plane facing +Y. Single-sided: only use where the underside is never seen. */
export function plane(w, d, opts = {}) {
  const { segmentsW = 1, segmentsD = 1, uvScale = 1 } = opts;
  let g = nonIndexed(new THREE.PlaneGeometry(w, d, segmentsW, segmentsD));
  g.rotateX(-Math.PI / 2);
  g = planarUV(g, { axis: 'y', scale: uvScale });
  return finish(flat(g));
}

/** Horizontal disc facing +Y. */
export function disc(r, opts = {}) {
  const { segments = 32, uvScale = 1 } = opts;
  let g = nonIndexed(new THREE.CircleGeometry(r, segments));
  g.rotateX(-Math.PI / 2);
  g = planarUV(g, { axis: 'y', scale: uvScale });
  return finish(flat(g));
}

/**
 * Rock: noise-displaced icosphere. squash scales [x, y, z]; roughness is the displacement amount.
 */
export function rock(radius, opts = {}) {
  const { detail = 2, roughness = 0.35, squash = [1, 0.75, 1], seed = 1, flat: faceted = true, uvScale = 1, base = false, frequency = 1.6 } = opts;
  const n = createNoise(seed);
  let g = nonIndexed(new THREE.IcosahedronGeometry(1, detail));
  const pos = g.attributes.position.array;
  const offs = createRng(seed).range(0, 100);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]; const y = pos[i + 1]; const z = pos[i + 2];
    const d = 1 + roughness * n.fbm3(x * frequency + offs, y * frequency, z * frequency, { octaves: 4 });
    const flatBottom = y < -0.55 ? 0.55 / Math.max(0.55, -y) : 1;
    pos[i] = x * d * radius * squash[0];
    pos[i + 1] = y * d * radius * squash[1] * flatBottom;
    pos[i + 2] = z * d * radius * squash[2];
  }
  g.attributes.position.needsUpdate = true;
  g = boxUV(g, { scale: uvScale });
  g = faceted ? flat(g) : crease(g, 45);
  return finish(g, { base });
}

/** Wooden plank / board: chamfered box with a tiny random warp so rows don't look cloned. */
export function plank(w, h, d, opts = {}) {
  const { bevel = Math.min(w, h, d) * 0.18, seed = 1, warp = 0.012, uvScale = 1, base = false } = opts;
  const rng = createRng(seed);
  let g = box(w, h, d, { bevel, uvScale });
  const longest = w >= h && w >= d ? 'x' : h >= d ? 'y' : 'z';
  const across = longest === 'y' ? 'z' : 'y';
  g = bend(g, { axis: longest, toward: across, angle: rng.jitter(warp) });
  if (warp > 0) g = jitter(g, { amount: Math.min(w, h, d) * 0.04, seed: rng.int(0, 1e9) });
  setShading(g, 'flat', 0);
  return finish(flat(g), { base });
}
