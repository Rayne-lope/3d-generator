// Terrain pieces: heightfield tiles for environment assets (diorama tiles, cliff modules,
// islands, building plots). For whole open-world landscapes use the engine's own
// terrain tools (Roblox Terrain, Godot terrain plugins) and build *pieces* here.

import * as THREE from 'three';
import { createNoise } from './noise.js';
import { createRng } from './rng.js';
import { crease, flat, smooth } from './ops.js';
import { box as boxUV } from './uv.js';
import { toSRGB } from './color.js';

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-9)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Heightfield terrain tile centered on the origin.
 * @param {object} opts
 * @param {number|number[]} [opts.size] meters (number or [width, depth])
 * @param {number|number[]} [opts.segments] grid cells (triangles = 2 × cells)
 * @param {(x:number, z:number, ctx:{noise:any}) => number} [opts.height] custom height in meters
 * @param {{amp?:number, scale?:number, octaves?:number, seed?:number, ridged?:boolean}} [opts.noise] default height when no fn
 * @param {{step:number, sharpness?:number}} [opts.terrace] stepped plateaus
 * @param {{at:number[], radius:number, height?:number, falloff?:number}[]} [opts.flatten] flat pads (building plots, paths)
 * @param {{falloff:number, height?:number}} [opts.edge] blend toward `height` near the border (islands, tiles that meet flat ground)
 * @param {number} [opts.skirt] side walls + bottom down to (min height - skirt): a closed diorama block
 * @param {'fit'|'world'} [opts.uv] 'fit' = top-down 0..1 (paint one texture over the tile), 'world' = meters × uvScale (tiling)
 * @param {'smooth'|'flat'|number} [opts.shading] 'flat' for faceted low-poly, a number = crease angle
 */
export function terrain(opts = {}) {
  const {
    size = 8, segments = 48, height = null, noise: nOpts = {}, terrace = null, flatten = [], edge = null,
    skirt = 0, uv = 'fit', uvScale = 1, shading = 'smooth', baseHeight = 0,
  } = opts;
  const [W, D] = Array.isArray(size) ? size : [size, size];
  const [nx, nz] = Array.isArray(segments) ? segments : [segments, Math.max(1, Math.round((segments * D) / W))];
  if (nx * nz * 2 > 60000) throw new Error(`k.geo.terrain: ${nx}x${nz} cells = ${nx * nz * 2} triangles is too dense; split into tiles`);
  const noise = createNoise(nOpts.seed ?? 1);
  const amp = nOpts.amp ?? 0.6;
  const freq = nOpts.scale ?? 0.25;
  const octaves = nOpts.octaves ?? 5;

  const rawHeight = (x, z) => {
    let h = baseHeight;
    if (height) h += height(x, z, { noise });
    else {
      const v = nOpts.ridged ? noise.ridged2(x * freq + 31.7, z * freq + 11.3, { octaves }) : noise.fbm2(x * freq + 31.7, z * freq + 11.3, { octaves }) * 0.5 + 0.5;
      h += v * amp;
    }
    if (terrace) {
      const step = terrace.step;
      const sharp = terrace.sharpness ?? 0.75;
      const k = h / step;
      const fl = Math.floor(k);
      const fr = k - fl;
      const ramp = smoothstep(0.5 - (1 - sharp) * 0.5, 0.5 + (1 - sharp) * 0.5, fr);
      h = (fl + ramp) * step;
    }
    for (const pad of flatten) {
      const d = Math.hypot(x - pad.at[0], z - pad.at[1]);
      const fo = pad.falloff ?? pad.radius * 0.75;
      if (d < pad.radius + fo) {
        const t = d <= pad.radius ? 1 : 1 - smoothstep(pad.radius, pad.radius + fo, d);
        h = lerp(h, pad.height ?? baseHeight, t);
      }
    }
    if (edge) {
      const dEdge = Math.min(x + W / 2, W / 2 - x, z + D / 2, D / 2 - z);
      const t = smoothstep(0, edge.falloff, dEdge);
      const target = edge.height ?? baseHeight;
      h = target + (h - target) * t;
    }
    return h;
  };

  const stride = nx + 1;
  const hs = new Float64Array((nx + 1) * (nz + 1));
  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = -W / 2 + (i / nx) * W;
      const z = -D / 2 + (j / nz) * D;
      const h = rawHeight(x, z);
      hs[j * stride + i] = h;
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
  }
  const gx = (i) => -W / 2 + (i / nx) * W;
  const gz = (j) => -D / 2 + (j / nz) * D;
  const H = (i, j) => hs[j * stride + i];

  const heightAt = (x, z) => {
    const fi = Math.min(nx - 1e-9, Math.max(0, ((x + W / 2) / W) * nx));
    const fj = Math.min(nz - 1e-9, Math.max(0, ((z + D / 2) / D) * nz));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const tx = fi - i;
    const tz = fj - j;
    return lerp(lerp(H(i, j), H(i + 1, j), tx), lerp(H(i, j + 1), H(i + 1, j + 1), tx), tz);
  };
  const cell = Math.min(W / nx, D / nz);
  const normalAt = (x, z) => {
    const hx = heightAt(x + cell, z) - heightAt(x - cell, z);
    const hz = heightAt(x, z + cell) - heightAt(x, z - cell);
    return new THREE.Vector3(-hx, 2 * cell, -hz).normalize();
  };
  const slopeAt = (x, z) => (Math.acos(Math.min(1, normalAt(x, z).y)) * 180) / Math.PI;

  // Top surface.
  const positions = [];
  const uvs = [];
  const pushV = (i, j) => {
    const x = gx(i);
    const z = gz(j);
    positions.push(x, H(i, j), z);
    if (uv === 'fit') uvs.push(i / nx, j / nz);
    else uvs.push(x * uvScale, z * uvScale);
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const diagAC = Math.abs(H(i, j) - H(i + 1, j + 1));
      const diagBD = Math.abs(H(i + 1, j) - H(i, j + 1));
      if (diagAC <= diagBD) {
        pushV(i, j); pushV(i + 1, j + 1); pushV(i + 1, j);
        pushV(i, j); pushV(i, j + 1); pushV(i + 1, j + 1);
      } else {
        pushV(i, j); pushV(i, j + 1); pushV(i + 1, j);
        pushV(i + 1, j); pushV(i, j + 1); pushV(i + 1, j + 1);
      }
    }
  }
  let top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  top = shading === 'flat' ? flat(top) : shading === 'smooth' ? smooth(top) : crease(top, shading);

  // Skirt: side walls and bottom → closed solid block.
  let sides = null;
  const bottomY = minH - skirt;
  if (skirt > 0) {
    const sp = [];
    const wallQuad = (x0, z0, h0, x1, z1, h1) => {
      // Outward-facing quad from the top edge down to bottomY (top edge given in CCW order seen from outside).
      sp.push(x0, h0, z0, x0, bottomY, z0, x1, bottomY, z1);
      sp.push(x0, h0, z0, x1, bottomY, z1, x1, h1, z1);
    };
    for (let i = 0; i < nx; i++) wallQuad(gx(i), gz(nz), H(i, nz), gx(i + 1), gz(nz), H(i + 1, nz)); // front (+Z)
    for (let i = nx; i > 0; i--) wallQuad(gx(i), gz(0), H(i, 0), gx(i - 1), gz(0), H(i - 1, 0)); // back (-Z)
    for (let j = 0; j < nz; j++) wallQuad(gx(0), gz(j), H(0, j), gx(0), gz(j + 1), H(0, j + 1)); // left (-X)
    for (let j = nz; j > 0; j--) wallQuad(gx(nx), gz(j), H(nx, j), gx(nx), gz(j - 1), H(nx, j - 1)); // right (+X)
    // Bottom (facing -Y).
    sp.push(-W / 2, bottomY, -D / 2, W / 2, bottomY, -D / 2, W / 2, bottomY, D / 2);
    sp.push(-W / 2, bottomY, -D / 2, W / 2, bottomY, D / 2, -W / 2, bottomY, D / 2);
    sides = new THREE.BufferGeometry();
    sides.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sides = boxUV(sides, { scale: uvScale });
    sides = flat(sides);
  }

  const info = (x, z) => {
    const y = heightAt(x, z);
    const n = normalAt(x, z);
    return { x, z, y, height: y, height01: (y - minH) / Math.max(1e-9, maxH - minH), slope: (Math.acos(Math.min(1, n.y)) * 180) / Math.PI, normal: n };
  };

  return {
    top,
    sides,
    size: [W, D],
    segments: [nx, nz],
    minHeight: minH,
    maxHeight: maxH,
    bottomY,
    heightAt,
    normalAt,
    slopeAt,
    info,
    /**
     * Split the top surface into one geometry per key: fn(info) gets the triangle center's
     * {x, z, y, slope (deg), height01, normal} and returns a key (e.g. 'grass' | 'rock').
     * Pair each key with a flat-color material for a crisp stylized look.
     */
    split(fn) {
      const pos = top.attributes.position.array;
      const nrm = top.attributes.normal.array;
      const uva = top.attributes.uv.array;
      const buckets = new Map();
      for (let v = 0; v < pos.length / 3; v += 3) {
        const cx = (pos[v * 3] + pos[v * 3 + 3] + pos[v * 3 + 6]) / 3;
        const cz = (pos[v * 3 + 2] + pos[v * 3 + 5] + pos[v * 3 + 8]) / 3;
        const ax = pos[v * 3 + 3] - pos[v * 3]; const ay = pos[v * 3 + 4] - pos[v * 3 + 1]; const az = pos[v * 3 + 5] - pos[v * 3 + 2];
        const bx = pos[v * 3 + 6] - pos[v * 3]; const by = pos[v * 3 + 7] - pos[v * 3 + 1]; const bz = pos[v * 3 + 8] - pos[v * 3 + 2];
        const fn3 = new THREE.Vector3(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx).normalize();
        const it = info(cx, cz);
        it.faceNormal = fn3;
        it.faceSlope = (Math.acos(Math.min(1, Math.abs(fn3.y))) * 180) / Math.PI;
        const key = fn(it);
        if (key === null || key === undefined) continue;
        if (!buckets.has(key)) buckets.set(key, { p: [], n: [], u: [] });
        const bk = buckets.get(key);
        for (let k = 0; k < 3; k++) {
          bk.p.push(pos[(v + k) * 3], pos[(v + k) * 3 + 1], pos[(v + k) * 3 + 2]);
          bk.n.push(nrm[(v + k) * 3], nrm[(v + k) * 3 + 1], nrm[(v + k) * 3 + 2]);
          bk.u.push(uva[(v + k) * 2], uva[(v + k) * 2 + 1]);
        }
      }
      const out = {};
      for (const [key, bk] of buckets) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(bk.p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.n, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.u, 2));
        g.userData = { ...top.userData };
        out[key] = g;
      }
      return out;
    },
    /**
     * Paint a 'fit'-UV texture from terrain data. fn(info + {u, v}) returns a color
     * ('#hex', [r,g,b] sRGB, number gray) or null to keep the existing pixel.
     */
    paint(painter, fn) {
      if (uv !== 'fit') throw new Error("terrain.paint needs uv: 'fit'");
      const Wp = painter.width;
      const Hp = painter.height;
      for (let y = 0; y < Hp; y++) {
        for (let x = 0; x < Wp; x++) {
          const u = (x + 0.5) / Wp;
          const v = (y + 0.5) / Hp;
          const it = info(-W / 2 + u * W, -D / 2 + v * D);
          it.u = u;
          it.v = v;
          const c = fn(it);
          if (c === null || c === undefined) continue;
          const rgb = Array.isArray(c) ? c : typeof c === 'number' && c <= 1 ? [c, c, c] : toSRGB(c);
          const i = (y * Wp + x) * 4;
          painter.data[i] = rgb[0];
          painter.data[i + 1] = rgb[1];
          painter.data[i + 2] = rgb[2];
        }
      }
      return painter;
    },
    /**
     * Scatter points on the terrain for trees/rocks. Deterministic.
     * Returns [{x, y, z, slope, normal, scale01}] respecting slope/height limits and spacing.
     */
    scatter({ count = 20, seed = 1, minDistance = 0.5, margin = 0.3, slope = [0, 35], heightRange = [-Infinity, Infinity], avoid = [], tries = 30 } = {}) {
      const rng = createRng(seed);
      const pts = [];
      let attempts = 0;
      while (pts.length < count && attempts < count * tries) {
        attempts++;
        const x = rng.range(-W / 2 + margin, W / 2 - margin);
        const z = rng.range(-D / 2 + margin, D / 2 - margin);
        const it = info(x, z);
        if (it.slope < slope[0] || it.slope > slope[1]) continue;
        if (it.y < heightRange[0] || it.y > heightRange[1]) continue;
        if (avoid.some((a) => Math.hypot(x - a.at[0], z - a.at[1]) < a.radius)) continue;
        if (pts.some((p) => Math.hypot(p.x - x, p.z - z) < minDistance)) continue;
        pts.push({ x, y: it.y, z, slope: it.slope, normal: it.normal, scale01: rng.float() });
      }
      return pts;
    },
  };
}
