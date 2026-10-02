// Surface bake: rasterize geometry with unique atlas UVs (k.uv.unwrap + k.uv.atlas) into
// per-texel surface data, so textures can be painted in 3D with painter.paint3d():
//
//   pos      3D position in meters (the geometry's own coordinates: author meshes in asset
//            space, as the kit expects, and patterns run on across parts)
//   normal   interpolated normal
//   entry    the atlas entry (geometry name) a texel belongs to
//   edge     0..1 closeness to a sharp convex edge (wear)        → bake.edges()
//   cavity   0..1 closeness to a sharp concave edge (grime)      → bake.edges()
//   ao       0..1 ambient occlusion, 1 = open                    → bake.ao()
//
// Texels outside every triangle but within `padding` px of one copy their nearest covered
// neighbour, so painted islands bleed into the gutter (no seams at mip levels or downscale).
// Pure JS and deterministic: the exporter (Node) and the parity render (browser) get the
// same texels. Bakes are cached by content, so skins of one model share the work.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const CACHE_MAX = 6;
const cache = new Map();

function hashFloats(h, arr) {
  const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
  for (let i = 0; i < u.length; i++) {
    h ^= u[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function contentKey(list, opts) {
  let h = 0x811c9dc5;
  for (const e of list) {
    h = hashFloats(h, e.pos);
    h = hashFloats(h, e.uv);
    if (e.nrm) h = hashFloats(h, e.nrm);
  }
  return `${h}:${list.map((e) => `${e.name}/${e.pos.length}`).join(',')}:${JSON.stringify(opts)}`;
}

/** Positions, normals and UVs of one entry as flat triangle-soup arrays (transform applied). */
function soup(name, g, matrix) {
  if (!g?.isBufferGeometry) throw new Error(`k.bake.surface: entry '${name}' is not a geometry`);
  const P = g.attributes.position;
  const U = g.attributes.uv;
  if (!U) throw new Error(`k.bake.surface: entry '${name}' has no UVs (use k.uv.unwrap + k.uv.atlas)`);
  const N = g.attributes.normal;
  const idx = g.index ? g.index.array : null;
  const count = idx ? idx.length : P.count;
  const pos = new Float32Array(count * 3);
  const nrm = N ? new Float32Array(count * 3) : null;
  const uv = new Float32Array(count * 2);
  const v = new THREE.Vector3();
  const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
  for (let i = 0; i < count; i++) {
    const vi = idx ? idx[i] : i;
    v.fromBufferAttribute(P, vi);
    if (matrix) v.applyMatrix4(matrix);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
    if (N) {
      v.fromBufferAttribute(N, vi);
      if (nm) v.applyMatrix3(nm).normalize();
      nrm[i * 3] = v.x;
      nrm[i * 3 + 1] = v.y;
      nrm[i * 3 + 2] = v.z;
    }
    uv[i * 2] = U.getX(vi);
    uv[i * 2 + 1] = U.getY(vi);
  }
  return { name, pos, nrm, uv };
}

/** Rasterize triangle soups into W×H texels (pixel centers), then dilate `padding` px. */
function rasterize(list, W, H, padding) {
  const n = W * H;
  const mask = new Uint8Array(n);
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const entry = new Uint16Array(n);
  const eps = 1e-7;
  list.forEach((e, ei) => {
    const P = e.pos;
    const U = e.uv;
    const N = e.nrm;
    const tris = P.length / 9;
    for (let t = 0; t < tris; t++) {
      const a = t * 3;
      const ax = U[a * 2] * W; const ay = U[a * 2 + 1] * H;
      const bx = U[a * 2 + 2] * W; const by = U[a * 2 + 3] * H;
      const cx = U[a * 2 + 4] * W; const cy = U[a * 2 + 5] * H;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-12) continue;
      // Face normal for meshes without normals (and as a fallback).
      const ux = P[a * 3 + 3] - P[a * 3]; const uy = P[a * 3 + 4] - P[a * 3 + 1]; const uz = P[a * 3 + 5] - P[a * 3 + 2];
      const wx = P[a * 3 + 6] - P[a * 3]; const wy = P[a * 3 + 7] - P[a * 3 + 1]; const wz = P[a * 3 + 8] - P[a * 3 + 2];
      let fx = uy * wz - uz * wy; let fy = uz * wx - ux * wz; let fz = ux * wy - uy * wx;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
          const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -eps || w1 < -eps || w2 < -eps) continue;
          const i = y * W + x;
          mask[i] = 1;
          entry[i] = ei;
          for (let k = 0; k < 3; k++) pos[i * 3 + k] = w0 * P[a * 3 + k] + w1 * P[a * 3 + 3 + k] + w2 * P[a * 3 + 6 + k];
          if (N) {
            let nx = w0 * N[a * 3] + w1 * N[a * 3 + 3] + w2 * N[a * 3 + 6];
            let ny = w0 * N[a * 3 + 1] + w1 * N[a * 3 + 4] + w2 * N[a * 3 + 7];
            let nz = w0 * N[a * 3 + 2] + w1 * N[a * 3 + 5] + w2 * N[a * 3 + 8];
            const l = Math.hypot(nx, ny, nz);
            if (l > 1e-8) {
              nx /= l; ny /= l; nz /= l;
            } else {
              nx = fx; ny = fy; nz = fz;
            }
            nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
          } else {
            nrm[i * 3] = fx; nrm[i * 3 + 1] = fy; nrm[i * 3 + 2] = fz;
          }
        }
      }
    }
  });
  // Gutter: breadth-first copy of the nearest covered texel (fixed order → deterministic).
  let frontier = [];
  for (let i = 0; i < n; i++) if (mask[i] === 1) frontier.push(i);
  const NB = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (let d = 0; d < padding && frontier.length; d++) {
    const next = [];
    for (const i of frontier) {
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of NB) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (mask[j]) continue;
        mask[j] = 2;
        entry[j] = entry[i];
        for (let k = 0; k < 3; k++) {
          pos[j * 3 + k] = pos[i * 3 + k];
          nrm[j * 3 + k] = nrm[i * 3 + k];
        }
        next.push(j);
      }
    }
    frontier = next;
  }
  return { mask, pos, nrm, entry };
}

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function pointSegDist(px, py, pz, s) {
  const ax = s[0]; const ay = s[1]; const az = s[2];
  const dx = s[3] - ax; const dy = s[4] - ay; const dz = s[5] - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px; const qy = ay + dy * t - py; const qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

/** Sharp edges per entry: [ax, ay, az, bx, by, bz, convex(1|0)] */
function sharpEdges(list, angleDeg) {
  const cosLimit = Math.cos((angleDeg * Math.PI) / 180);
  const out = list.map(() => []);
  list.forEach((e, ei) => {
    const P = e.pos;
    const tris = P.length / 9;
    const q = (i) => `${Math.round(P[i * 3] * 1e5)},${Math.round(P[i * 3 + 1] * 1e5)},${Math.round(P[i * 3 + 2] * 1e5)}`;
    const faceN = new Float64Array(tris * 3);
    const faceC = new Float64Array(tris * 3);
    const edges = new Map();
    for (let t = 0; t < tris; t++) {
      const a = t * 3;
      const ux = P[a * 3 + 3] - P[a * 3]; const uy = P[a * 3 + 4] - P[a * 3 + 1]; const uz = P[a * 3 + 5] - P[a * 3 + 2];
      const wx = P[a * 3 + 6] - P[a * 3]; const wy = P[a * 3 + 7] - P[a * 3 + 1]; const wz = P[a * 3 + 8] - P[a * 3 + 2];
      let nx = uy * wz - uz * wy; let ny = uz * wx - ux * wz; let nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-14) continue;
      nx /= l; ny /= l; nz /= l;
      faceN[t * 3] = nx; faceN[t * 3 + 1] = ny; faceN[t * 3 + 2] = nz;
      for (let k = 0; k < 3; k++) faceC[t * 3 + k] = (P[a * 3 + k] + P[a * 3 + 3 + k] + P[a * 3 + 6 + k]) / 3;
      for (let k = 0; k < 3; k++) {
        const va = a + k;
        const vb = a + ((k + 1) % 3);
        const ka = q(va);
        const kb = q(vb);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        let rec = edges.get(key);
        if (!rec) edges.set(key, (rec = { a: va, b: vb, faces: [] }));
        rec.faces.push(t);
      }
    }
    for (const rec of edges.values()) {
      let convex;
      if (rec.faces.length === 1) convex = 1;
      else if (rec.faces.length === 2) {
        const [t1, t2] = rec.faces;
        const cos = faceN[t1 * 3] * faceN[t2 * 3] + faceN[t1 * 3 + 1] * faceN[t2 * 3 + 1] + faceN[t1 * 3 + 2] * faceN[t2 * 3 + 2];
        if (cos > cosLimit) continue;
        const side = (faceC[t2 * 3] - faceC[t1 * 3]) * faceN[t1 * 3] + (faceC[t2 * 3 + 1] - faceC[t1 * 3 + 1]) * faceN[t1 * 3 + 1] + (faceC[t2 * 3 + 2] - faceC[t1 * 3 + 2]) * faceN[t1 * 3 + 2];
        convex = side < 0 ? 1 : 0;
      } else continue;
      out[ei].push([P[rec.a * 3], P[rec.a * 3 + 1], P[rec.a * 3 + 2], P[rec.b * 3], P[rec.b * 3 + 1], P[rec.b * 3 + 2], convex]);
    }
  });
  return out;
}

// Cosine-weighted hemisphere directions (Hammersley points), fixed for determinism.
function hemisphere(count) {
  const dirs = [];
  for (let i = 0; i < count; i++) {
    let bits = i;
    bits = ((bits << 16) | (bits >>> 16)) >>> 0;
    bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
    bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
    bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
    bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
    const u = (i + 0.5) / count;
    const v = bits / 4294967296;
    const r = Math.sqrt(u);
    const phi = 2 * Math.PI * v;
    dirs.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - u))]);
  }
  return dirs;
}

// The rasterized core is shared (cached by content); each surface() call gets its own view,
// so edge/AO data is only visible to a build that asked for it (no state leaks between builds).
class BakeCore {
  constructor(list, { size, height, padding }) {
    this.list = list;
    this.width = size;
    this.height = height;
    this.padding = padding;
    Object.assign(this, rasterize(list, size, height, padding));
    this.edgeCache = new Map();
    this.aoCache = new Map();
  }
}

class SurfaceBake {
  constructor(core) {
    this._core = core;
    this._list = core.list;
    this.width = core.width;
    this.height = core.height;
    this.padding = core.padding;
    this.entryNames = core.list.map((e) => e.name);
    this.mask = core.mask;
    this.pos = core.pos;
    this.normal = core.nrm;
    this.entry = core.entry;
    this.edge = null;
    this.cavity = null;
    this.aoMap = null;
    let covered = 0;
    for (let i = 0; i < this.mask.length; i++) if (this.mask[i] === 1) covered++;
    this.coverage = covered / this.mask.length;
  }

  /**
   * Edge masks from the real mesh: `edge` (convex, for wear) and `cavity` (concave, for grime),
   * 1 on a sharp edge fading to 0 at `width` meters. A sharp edge is one where the faces meet
   * at more than `angle` degrees; open (boundary) edges count as convex.
   */
  edges({ angle = 35, width = 0.004, sameEntry = true } = {}) {
    const key = JSON.stringify({ angle, width, sameEntry });
    const cached = this._core.edgeCache.get(key);
    if (cached) {
      this.edge = cached.edge;
      this.cavity = cached.cavity;
      return this;
    }
    const segs = sharpEdges(this._list, angle);
    const cell = Math.max(width, 1e-4);
    const grid = new Map();
    const gkey = (x, y, z) => `${x},${y},${z}`;
    segs.forEach((list, ei) => {
      for (const s of list) {
        const x0 = Math.floor((Math.min(s[0], s[3]) - width) / cell);
        const x1 = Math.floor((Math.max(s[0], s[3]) + width) / cell);
        const y0 = Math.floor((Math.min(s[1], s[4]) - width) / cell);
        const y1 = Math.floor((Math.max(s[1], s[4]) + width) / cell);
        const z0 = Math.floor((Math.min(s[2], s[5]) - width) / cell);
        const z1 = Math.floor((Math.max(s[2], s[5]) + width) / cell);
        const cells = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
        if (cells > 20000) continue; // absurdly long edge for this width: skip rather than stall
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            for (let z = z0; z <= z1; z++) {
              const k = gkey(x, y, z);
              let arr = grid.get(k);
              if (!arr) grid.set(k, (arr = []));
              arr.push(s, ei);
            }
          }
        }
      }
    });
    const n = this.mask.length;
    const edge = new Float32Array(n);
    const cavity = new Float32Array(n);
    const P = this.pos;
    for (let i = 0; i < n; i++) {
      if (!this.mask[i]) continue;
      const px = P[i * 3]; const py = P[i * 3 + 1]; const pz = P[i * 3 + 2];
      const arr = grid.get(gkey(Math.floor(px / cell), Math.floor(py / cell), Math.floor(pz / cell)));
      if (!arr) continue;
      let dc = Infinity;
      let dv = Infinity;
      const ei = this.entry[i];
      for (let k = 0; k < arr.length; k += 2) {
        if (sameEntry && arr[k + 1] !== ei) continue;
        const s = arr[k];
        const d = pointSegDist(px, py, pz, s);
        if (s[6]) {
          if (d < dc) dc = d;
        } else if (d < dv) dv = d;
      }
      if (dc < width) edge[i] = smooth01(1 - dc / width);
      if (dv < width) cavity[i] = smooth01(1 - dv / width);
    }
    this._core.edgeCache.set(key, { edge, cavity });
    this.edge = edge;
    this.cavity = cavity;
    return this;
  }

  /**
   * Ambient occlusion (1 = open sky, 0 = fully blocked) from rays against every baked entry,
   * computed at a low resolution and upsampled (AO is soft, so this is enough and fast).
   */
  ao({ samples = 16, distance = 0.05, size = 128, bias = 0.0015, blur = 1 } = {}) {
    const key = JSON.stringify({ samples, distance, size, bias, blur });
    const cached = this._core.aoCache.get(key);
    if (cached) {
      this.aoMap = cached;
      return this;
    }
    const all = [];
    for (const e of this._list) all.push(e.pos);
    const total = all.reduce((s, a) => s + a.length, 0);
    const merged = new Float32Array(total);
    let o = 0;
    for (const a of all) {
      merged.set(a, o);
      o += a.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(merged, 3));
    const bvh = new MeshBVH(g);
    const W = Math.max(8, Math.min(size, this.width));
    const H = Math.max(8, Math.round((W * this.height) / this.width));
    const low = rasterize(this._list, W, H, 2);
    const dirs = hemisphere(samples);
    const ray = new THREE.Ray();
    const lowAO = new Float32Array(W * H).fill(1);
    for (let i = 0; i < W * H; i++) {
      if (!low.mask[i]) continue;
      const nx = low.nrm[i * 3]; const ny = low.nrm[i * 3 + 1]; const nz = low.nrm[i * 3 + 2];
      // Orthonormal basis around the normal.
      let tx; let ty; let tz;
      if (Math.abs(nx) < 0.9) {
        tx = 0; ty = -nz; tz = ny;
      } else {
        tx = nz; ty = 0; tz = -nx;
      }
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      const bx = ny * tz - nz * ty; const by = nz * tx - nx * tz; const bz = nx * ty - ny * tx;
      const ox = low.pos[i * 3] + nx * bias; const oy = low.pos[i * 3 + 1] + ny * bias; const oz = low.pos[i * 3 + 2] + nz * bias;
      let blocked = 0;
      for (const [a, b, c] of dirs) {
        ray.origin.set(ox, oy, oz);
        ray.direction.set(tx * a + bx * b + nx * c, ty * a + by * b + ny * c, tz * a + bz * b + nz * c);
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, distance);
        if (hit) blocked += 1 - (hit.distance / distance) ** 2;
      }
      lowAO[i] = 1 - blocked / dirs.length;
    }
    for (let pass = 0; pass < blur; pass++) {
      const src = lowAO.slice();
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!low.mask[i]) continue;
          let s = 0;
          let c = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              const j = yy * W + xx;
              if (!low.mask[j] || low.entry[j] !== low.entry[i]) continue;
              s += src[j];
              c++;
            }
          }
          lowAO[i] = s / c;
        }
      }
    }
    // Upsample: bilinear over covered low-res texels of the same entry.
    const n = this.mask.length;
    const aoMap = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      if (!this.mask[i]) continue;
      const x = i % this.width;
      const y = (i - x) / this.width;
      const fx = ((x + 0.5) * W) / this.width - 0.5;
      const fy = ((y + 0.5) * H) / this.height - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ei = this.entry[i];
      let s = 0;
      let wsum = 0;
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x0 + dx));
          const yy = Math.min(H - 1, Math.max(0, y0 + dy));
          const j = yy * W + xx;
          if (!low.mask[j] || low.entry[j] !== ei) continue;
          const w = (dx ? fx - x0 : 1 - (fx - x0)) * (dy ? fy - y0 : 1 - (fy - y0)) + 1e-6;
          s += lowAO[j] * w;
          wsum += w;
        }
      }
      aoMap[i] = wsum > 0 ? s / wsum : 1;
    }
    this._core.aoCache.set(key, aoMap);
    this.aoMap = aoMap;
    return this;
  }

  /** Call fn(p) for every covered (and gutter) texel; p is reused between calls. */
  forEach(fn) {
    const W = this.width;
    const p = { i: 0, x: 0, y: 0, u: 0, v: 0, pos: [0, 0, 0], normal: [0, 0, 0], entry: '', gutter: false, edge: 0, cavity: 0, ao: 1 };
    for (let i = 0; i < this.mask.length; i++) {
      if (!this.mask[i]) continue;
      fillPoint(this, p, i, W);
      fn(p);
    }
  }
}

function fillPoint(bake, p, i, W) {
  const x = i % W;
  const y = (i - x) / W;
  p.i = i;
  p.x = x;
  p.y = y;
  p.u = (x + 0.5) / W;
  p.v = (y + 0.5) / bake.height;
  p.pos[0] = bake.pos[i * 3];
  p.pos[1] = bake.pos[i * 3 + 1];
  p.pos[2] = bake.pos[i * 3 + 2];
  p.normal[0] = bake.normal[i * 3];
  p.normal[1] = bake.normal[i * 3 + 1];
  p.normal[2] = bake.normal[i * 3 + 2];
  p.entry = bake.entryNames[bake.entry[i]];
  p.gutter = bake.mask[i] === 2;
  p.edge = bake.edge ? bake.edge[i] : 0;
  p.cavity = bake.cavity ? bake.cavity[i] : 0;
  p.ao = bake.aoMap ? bake.aoMap[i] : 1;
}

export { fillPoint };

/**
 * Bake atlas geometry into texel data for painter.paint3d().
 * @param {Record<string, THREE.BufferGeometry>} entries the same map passed to k.uv.atlas()
 * @param {{size?: number, padding?: number, transforms?: Record<string, THREE.Matrix4>}} [opts]
 *   size: texture size in px (default: the atlas size); padding: gutter px to fill (default 8);
 *   transforms: optional matrices for entries placed with mesh transforms instead of k.op.*
 */
export function surface(entries, { size = null, padding = 8, transforms = null } = {}) {
  const names = Object.keys(entries);
  if (!names.length) throw new Error('k.bake.surface: no entries');
  const atlasSize = entries[names[0]]?.userData?.atlas?.size;
  const W = size || atlasSize;
  if (!Number.isInteger(W) || W < 8 || W > 8192) throw new Error('k.bake.surface: pass { size } (texture size in px) or bake geometries packed with k.uv.atlas');
  const list = names.map((name) => soup(name, entries[name], transforms?.[name] || null));
  const key = contentKey(list, { W, padding });
  let core = cache.get(key);
  if (core) cache.delete(key);
  else core = new BakeCore(list, { size: W, height: W, padding });
  cache.set(key, core);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return new SurfaceBake(core);
}
