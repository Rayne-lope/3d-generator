// 3D surface patterns for skins. Each pattern is a function of a baked surface point
// p = { pos: [x, y, z] (meters), normal: [x, y, z] } that returns a painter-space sRGB color
// [r, g, b] in 0..1, so it can be passed straight to painter.paint3d(bake, pattern).
// Volumetric patterns (camo, digital, tiger) are continuous across UV seams and parts;
// planar ones (hex, carbon) project along the dominant normal axis, like a decal per face.
// Patterns with discrete colors also expose .index(p) (which color) and .colors.

import { createNoise } from './noise.js';
import { toSRGB } from './color.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const frac = (x) => x - Math.floor(x);

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function palette(colors, min, name) {
  if (!Array.isArray(colors) || colors.length < min) throw new Error(`k.tex.pattern.${name}: pass at least ${min} colors`);
  return colors.map((c) => toSRGB(c));
}

/** Thresholds that make each layer cover roughly the requested fraction of the surface. */
function quantiles(n, coverage, octaves, freqOf, offsetOf) {
  const out = [];
  coverage.forEach((c, l) => {
    const vals = [];
    for (let i = 0; i < 2048; i++) {
      // Fixed low-discrepancy sample points inside a 16³ block of noise space.
      const x = frac(i * 0.7548776662) * 16;
      const y = frac(i * 0.5698402910) * 16;
      const z = frac(i * 0.3247179572) * 16;
      const f = freqOf(l);
      const o = offsetOf(l);
      vals.push(n.fbm3(x * f + o[0], y * f + o[1], z * f + o[2], { octaves }));
    }
    vals.sort((a, b) => a - b);
    out.push(vals[Math.min(vals.length - 1, Math.max(0, Math.round((1 - c) * (vals.length - 1))))]);
  });
  return out;
}

function makeIndexed(index, cols) {
  const f = (p) => cols[index(p)];
  f.index = index;
  f.colors = cols;
  return f;
}

/**
 * Organic camouflage: colors[0] is the ground, every next color is a layer of blobs painted on
 * top. scale = blob size in meters (relative to the object!), coverage = share of the surface
 * each layer covers, warp = how much blob outlines are pushed around.
 * Presets: colors for woodland, desert, arctic… are a prompt decision, not built in.
 */
export function camo({ colors, scale = 0.08, coverage = null, warp = 0.6, detail = 3, seed = 1 } = {}) {
  const cols = palette(colors, 2, 'camo');
  const n = createNoise(seed);
  const layers = cols.length - 1;
  const cover = coverage || Array.from({ length: layers }, (_, i) => [0.45, 0.35, 0.25, 0.18, 0.12][i] ?? 0.1);
  const freqOf = (l) => 1 + 0.27 * l;
  const offsetOf = (l) => [l * 17.3, -l * 9.1, l * 5.7];
  const th = quantiles(n, cover, detail, freqOf, offsetOf);
  const s = 1 / scale;
  const index = (p, override = null) => {
    let x = (override ? override[0] : p.pos[0]) * s;
    let y = (override ? override[1] : p.pos[1]) * s;
    let z = (override ? override[2] : p.pos[2]) * s;
    if (warp) {
      const wx = n.fbm3(x * 0.5 + 31.7, y * 0.5 + 3.1, z * 0.5 - 7.9, { octaves: 2 });
      const wy = n.fbm3(x * 0.5 - 12.4, y * 0.5 + 22.9, z * 0.5 + 4.2, { octaves: 2 });
      const wz = n.fbm3(x * 0.5 + 5.5, y * 0.5 - 17.2, z * 0.5 + 29.3, { octaves: 2 });
      x += wx * warp * 2;
      y += wy * warp * 2;
      z += wz * warp * 2;
    }
    let idx = 0;
    for (let l = 0; l < layers; l++) {
      const f = freqOf(l);
      const o = offsetOf(l);
      if (n.fbm3(x * f + o[0], y * f + o[1], z * f + o[2], { octaves: detail }) > th[l]) idx = l + 1;
    }
    return idx;
  };
  const f = makeIndexed((p) => index(p), cols);
  f._index = index;
  return f;
}

/**
 * Digital (pixel) camouflage: the camo pattern sampled on a grid of `cell`-sized cubes, so
 * every face shows square pixels. cell = pixel size in meters.
 */
export function digital({ colors, cell = 0.01, scale = 0.08, coverage = null, warp = 0.5, detail = 2, seed = 1 } = {}) {
  const base = camo({ colors, scale, coverage, warp, detail, seed });
  const q = [0, 0, 0];
  const index = (p) => {
    // Nudge along the normal so a texel on a face never sits exactly on a cell boundary.
    for (let k = 0; k < 3; k++) q[k] = (Math.floor((p.pos[k] - p.normal[k] * cell * 0.25) / cell) + 0.5) * cell;
    return base._index(p, q);
  };
  return makeIndexed(index, base.colors);
}

/**
 * Tiger stripe: broken brush-stroke stripes over a two-tone ground.
 * colors = [ground, blotch, stripe]; spacing = distance between stripes (m); axis = direction
 * the stripes stack along (default: mostly up, so stripes run horizontally).
 */
export function tiger({ colors, spacing = 0.03, width = 0.42, scale = 0.09, axis = [0.18, 1, 0.55], seed = 1 } = {}) {
  const cols = palette(colors, 2, 'tiger');
  const n = createNoise(seed);
  const a = normalize(axis);
  const blotchTh = quantiles(n, [0.4], 2, () => 1, () => [41.2, 7.7, -3.3])[0];
  const index = (p) => {
    const [x, y, z] = p.pos;
    const sx = x / scale; const sy = y / scale; const sz = z / scale;
    const t = (x * a[0] + y * a[1] + z * a[2]) / spacing + n.fbm3(sx * 0.7, sy * 0.7, sz * 0.7, { octaves: 3 }) * 1.8;
    const stripeId = Math.floor(t);
    const f = frac(t);
    // Strokes: the stripe's width swells and breaks along its length.
    const stroke = n.fbm3(sx * 1.6 + stripeId * 3.7, sy * 0.4, sz * 1.6 - stripeId * 1.3, { octaves: 2 });
    const w = width * smoothstep(-0.25, 0.35, stroke);
    if (cols.length > 2 && Math.abs(f - 0.5) * 2 < w) return 2;
    if (cols.length === 2 && Math.abs(f - 0.5) * 2 < w) return 1;
    if (cols.length > 2 && n.fbm3(sx + 41.2, sy + 7.7, sz - 3.3, { octaves: 2 }) > blotchTh) return 1;
    return 0;
  };
  return makeIndexed(index, cols);
}

/** 2D coordinates on the plane facing the dominant normal axis (planar patterns). */
function planar(p) {
  const [nx, ny, nz] = p.normal;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ax >= ay && ax >= az) return [p.pos[2] * Math.sign(nx || 1), p.pos[1]];
  if (ay >= az) return [p.pos[0], p.pos[2] * Math.sign(ny || 1)];
  return [p.pos[0] * Math.sign(nz || 1), p.pos[1]];
}

/**
 * Hexagon grid (projected per face). colors = [fill, line, (accent)]; size = hex radius (m);
 * line = line width as a fraction of the hex; accent: share of cells filled with colors[2].
 */
export function hex({ colors, size = 0.01, line = 0.14, accent = 0.12, seed = 1 } = {}) {
  const cols = palette(colors, 2, 'hex');
  const SQ3 = Math.sqrt(3);
  const inner = (size * SQ3) / 2;
  const index = (p) => {
    const [x, y] = planar(p);
    // Pointy-top axial coordinates, cube rounding.
    const qf = ((SQ3 / 3) * x - y / 3) / size;
    const rf = ((2 / 3) * y) / size;
    const sf = -qf - rf;
    let q = Math.round(qf);
    let r = Math.round(rf);
    const s = Math.round(sf);
    const dq = Math.abs(q - qf);
    const dr = Math.abs(r - rf);
    const ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    const cx = size * SQ3 * (q + r / 2);
    const cy = size * 1.5 * r;
    const dx = Math.abs(x - cx);
    const dy = Math.abs(y - cy);
    // Pointy-top hex: edge normals at 0°, 60°, 120° → distance to the nearest edge.
    const d = Math.max(dx, dx * 0.5 + dy * (SQ3 / 2));
    if (inner - d < inner * line) return 1;
    if (cols.length > 2) {
      const h = Math.sin((q * 127.1 + r * 311.7 + seed * 74.7) * 0.0174533) * 43758.5453;
      if (frac(h) < accent) return 2;
    }
    return 0;
  };
  return makeIndexed(index, cols);
}

/**
 * Carbon-fibre 2×2 twill (projected per face). colors = [dark, light]; size = tow width (m).
 */
export function carbon({ colors = ['#141518', '#3a3d44'], size = 0.004 } = {}) {
  const [dark, light] = palette(colors, 2, 'carbon');
  return (p) => {
    const [x, y] = planar(p);
    const u = x / size;
    const v = y / size;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const horizontal = ((((i - j) % 4) + 4) % 4) < 2;
    const across = horizontal ? frac(v) : frac(u);
    const along = horizontal ? frac(u / 2 + (j % 2) * 0.25) : frac(v / 2 + (i % 2) * 0.25);
    const t = Math.sin(across * Math.PI) * (0.65 + 0.35 * Math.sin(along * Math.PI)) * (horizontal ? 1 : 0.7);
    return [dark[0] + (light[0] - dark[0]) * t, dark[1] + (light[1] - dark[1]) * t, dark[2] + (light[2] - dark[2]) * t];
  };
}

/**
 * Brushed metal streaks along an axis: the color varies by ±amount in fine lines.
 * axis = brushing direction; scale = streak width (m).
 */
export function brushed({ color, axis = [1, 0, 0], amount = 0.08, scale = 0.0015, seed = 1 } = {}) {
  const c = toSRGB(color);
  const n = createNoise(seed);
  const a = normalize(axis);
  const helper = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const b = normalize([a[1] * helper[2] - a[2] * helper[1], a[2] * helper[0] - a[0] * helper[2], a[0] * helper[1] - a[1] * helper[0]]);
  const d = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return (p) => {
    const [x, y, z] = p.pos;
    const along = (x * a[0] + y * a[1] + z * a[2]) / (scale * 60);
    const u = (x * b[0] + y * b[1] + z * b[2]) / scale;
    const v = (x * d[0] + y * d[1] + z * d[2]) / scale;
    const k = 1 + amount * n.fbm3(along, u, v, { octaves: 2 });
    return [clamp01(c[0] * k), clamp01(c[1] * k), clamp01(c[2] * k)];
  };
}

export const pattern = { camo, digital, tiger, hex, carbon, brushed };
