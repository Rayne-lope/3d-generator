// Pure-JS procedural texture painter. Runs identically in Node and the browser, so the
// exporter (Node) and the source-vs-GLB parity render (browser) see the same pixels.
//
// Coordinates: u goes right, v goes DOWN (row 0 is the top of the image), matching glTF.
// Painters are either 'srgb' (base color, emissive) or 'linear' (normal, ORM, height).
// Layout 'tiling' = seamless texture used with REPEAT and world-scale UVs.
// Layout 'atlas'  = unique UV layout (see k.uv.atlas); padding between islands matters.

import * as THREE from 'three';
import { toSRGB } from './color.js';
import { createNoise } from './noise.js';
import { createRng, hashString } from './rng.js';
import { fillPoint } from './bake.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0, e1, x) => {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const BLEND_MODES = new Set(['normal', 'multiply', 'add', 'screen', 'overlay', 'subtract', 'max', 'min']);

let painterCounter = 0;

/** Restart the numbering of unnamed painters (runAsset calls this before every build). */
export function resetPainterNames() {
  painterCounter = 0;
}

export class TexturePainter {
  /**
   * @param {number} width
   * @param {number} height
   * @param {{space?: 'srgb'|'linear', tileable?: boolean, layout?: 'tiling'|'atlas', seed?: number|string, name?: string}} [opts]
   */
  constructor(width, height, opts = {}) {
    const { space = 'srgb', tileable, layout = 'tiling', seed = 1, name } = opts;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
      throw new Error(`k.tex.create: invalid size ${width}x${height} (integers 1..8192)`);
    }
    if (space !== 'srgb' && space !== 'linear') throw new Error(`k.tex.create: space must be 'srgb' or 'linear'`);
    if (layout !== 'tiling' && layout !== 'atlas') throw new Error(`k.tex.create: layout must be 'tiling' or 'atlas'`);
    this.width = width;
    this.height = height;
    this.space = space;
    this.layout = layout;
    this.tileable = tileable ?? layout === 'tiling';
    this.seed = typeof seed === 'string' ? hashString(seed) : Math.floor(seed);
    this.name = name || `tex${++painterCounter}`;
    this.data = new Float32Array(width * height * 4);
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 1;
    this.hasAO = false;
    this._texture = null;
    this._opCount = 0;
  }

  // ---------------------------------------------------------------- helpers

  _seed(seed) {
    this._opCount++;
    return seed ?? hashString(`${this.seed}:${this.name}:${this._opCount}`);
  }

  /** Parse an authoring color into painter-space components [r, g, b]. */
  _rgb(input) {
    if (typeof input === 'number' && input >= 0 && input <= 1 && !Number.isInteger(input)) return [input, input, input];
    if (input === 0 || input === 1) return [input, input, input];
    return toSRGB(input);
  }

  _blendAt(i, r, g, b, a, mode) {
    if (a <= 0) return;
    const d = this.data;
    const dr = d[i];
    const dg = d[i + 1];
    const db = d[i + 2];
    let nr;
    let ng;
    let nb;
    switch (mode) {
      case 'multiply': nr = dr * r; ng = dg * g; nb = db * b; break;
      case 'add': nr = dr + r; ng = dg + g; nb = db + b; break;
      case 'subtract': nr = dr - r; ng = dg - g; nb = db - b; break;
      case 'screen': nr = 1 - (1 - dr) * (1 - r); ng = 1 - (1 - dg) * (1 - g); nb = 1 - (1 - db) * (1 - b); break;
      case 'overlay':
        nr = dr < 0.5 ? 2 * dr * r : 1 - 2 * (1 - dr) * (1 - r);
        ng = dg < 0.5 ? 2 * dg * g : 1 - 2 * (1 - dg) * (1 - g);
        nb = db < 0.5 ? 2 * db * b : 1 - 2 * (1 - db) * (1 - b);
        break;
      case 'max': nr = Math.max(dr, r); ng = Math.max(dg, g); nb = Math.max(db, b); break;
      case 'min': nr = Math.min(dr, r); ng = Math.min(dg, g); nb = Math.min(db, b); break;
      default: nr = r; ng = g; nb = b;
    }
    d[i] = clamp01(dr + (nr - dr) * a);
    d[i + 1] = clamp01(dg + (ng - dg) * a);
    d[i + 2] = clamp01(db + (nb - db) * a);
  }

  _mode(mode) {
    if (!BLEND_MODES.has(mode)) throw new Error(`texture: unknown blend mode '${mode}' (${[...BLEND_MODES].join(', ')})`);
    return mode;
  }

  /**
   * Run `cb(px, py, offsetU, offsetV)` over a pixel bounding box given in UV units,
   * repeating across edges when the painter is tileable.
   */
  _forBox(u0, v0, u1, v1, cb) {
    const W = this.width;
    const H = this.height;
    const offsets = this.tileable ? [-1, 0, 1] : [0];
    for (const ov of offsets) {
      for (const ou of offsets) {
        const x0 = Math.max(0, Math.floor((u0 + ou) * W) - 1);
        const x1 = Math.min(W - 1, Math.ceil((u1 + ou) * W) + 1);
        const y0 = Math.max(0, Math.floor((v0 + ov) * H) - 1);
        const y1 = Math.min(H - 1, Math.ceil((v1 + ov) * H) + 1);
        if (x0 > x1 || y0 > y1) continue;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) cb(x, y, ou, ov);
        }
      }
    }
  }

  // ---------------------------------------------------------------- basic ops

  /** Fill the whole texture with a color. */
  fill(color, alpha = 1) {
    const [r, g, b] = this._rgb(color);
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) this._blendAt(i, r, g, b, alpha, 'normal');
    return this;
  }

  /**
   * Per-pixel function: fn({x, y, u, v, r, g, b, a}) returns [r,g,b], [r,g,b,a] or null (keep).
   * Values are in painter space (sRGB for 'srgb' painters).
   */
  map(fn) {
    const W = this.width;
    const H = this.height;
    const d = this.data;
    const px = { x: 0, y: 0, u: 0, v: 0, r: 0, g: 0, b: 0, a: 1 };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        px.x = x;
        px.y = y;
        px.u = (x + 0.5) / W;
        px.v = (y + 0.5) / H;
        px.r = d[i];
        px.g = d[i + 1];
        px.b = d[i + 2];
        px.a = d[i + 3];
        const out = fn(px);
        if (!out) continue;
        d[i] = clamp01(out[0]);
        d[i + 1] = clamp01(out[1]);
        d[i + 2] = clamp01(out[2]);
        if (out.length > 3) d[i + 3] = clamp01(out[3]);
      }
    }
    return this;
  }

  /**
   * Paint in 3D on a surface bake (k.bake.surface) of the same size. fn(p) runs for every texel
   * the bake covers, gutter included, with p = { pos, normal, entry, edge, cavity, ao, gutter,
   * i, x, y, u, v } (p is reused: copy what you keep) and returns [r, g, b] (painter space),
   * [r, g, b, a], a color ('#hex', number gray) or null to keep the texel. Patterns from
   * k.tex.pattern are valid fns. Texels outside the bake are not touched.
   */
  paint3d(bake, fn, { alpha = 1, mode = 'normal' } = {}) {
    if (!bake || !bake.mask) throw new Error('paint3d: pass a bake from k.bake.surface()');
    if (bake.width !== this.width || bake.height !== this.height) {
      throw new Error(`paint3d: painter '${this.name}' is ${this.width}x${this.height} but the bake is ${bake.width}x${bake.height} (bake with { size: ${this.width} })`);
    }
    const m = this._mode(mode);
    const d = this.data;
    const W = this.width;
    const p = { i: 0, x: 0, y: 0, u: 0, v: 0, pos: [0, 0, 0], normal: [0, 0, 0], entry: '', gutter: false, edge: 0, cavity: 0, ao: 1 };
    const direct = m === 'normal' && alpha === 1;
    for (let i = 0; i < bake.mask.length; i++) {
      if (!bake.mask[i]) continue;
      fillPoint(bake, p, i, W);
      let out = fn(p);
      if (out === null || out === undefined) continue;
      if (!Array.isArray(out) && !(out instanceof Float32Array)) out = this._rgb(out);
      const o = i * 4;
      if (direct) {
        d[o] = clamp01(out[0]);
        d[o + 1] = clamp01(out[1]);
        d[o + 2] = clamp01(out[2]);
      } else this._blendAt(o, out[0], out[1], out[2], alpha, m);
      if (out.length > 3) d[o + 3] = clamp01(out[3]);
    }
    return this;
  }

  /**
   * Blend `color` using a noise field as the mask.
   * type: 'fbm' | 'ridged' | 'cells' | 'cell-edges'. Tileable painters round `scale` to integers.
   */
  noise(opts = {}) {
    const {
      color = '#000000', amount = 1, scale = 4, octaves = 4, gain = 0.5, lacunarity = 2,
      contrast = 1, bias = 0, threshold = null, softness = 0.08, mode = 'normal', type = 'fbm',
      stretch = [1, 1], invert = false, seed,
    } = opts;
    const n = createNoise(this._seed(seed));
    const [r, g, b] = this._rgb(color);
    const m = this._mode(mode);
    const sx = this.tileable ? Math.max(1, Math.round(scale * stretch[0])) : scale * stretch[0];
    const sy = this.tileable ? Math.max(1, Math.round(scale * stretch[1])) : scale * stretch[1];
    const W = this.width;
    const H = this.height;
    const d = this.data;
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        let t;
        if (type === 'cells' || type === 'cell-edges') {
          const w = n.worley2(u * sx, v * sx, this.tileable ? sx : 0);
          t = type === 'cells' ? w.id : clamp01(1 - (w.f2 - w.f1) * 4);
        } else {
          const fx = u * sx;
          const fy = v * sy;
          let val;
          if (type === 'ridged') {
            val = this.tileable ? tileRidged(n, fx, fy, sx, sy, octaves, gain, lacunarity) * 2 - 1 : n.ridged2(fx, fy, { octaves, gain, lacunarity }) * 2 - 1;
          } else {
            val = this.tileable ? tileFbm(n, fx, fy, sx, sy, octaves, gain, lacunarity) : n.fbm2(fx, fy, { octaves, gain, lacunarity });
          }
          t = clamp01((val * contrast + 1) / 2 + bias);
        }
        if (invert) t = 1 - t;
        if (threshold !== null) t = smoothstep(threshold - softness, threshold + softness, t);
        this._blendAt((y * W + x) * 4, r, g, b, t * amount, m);
      }
    }
    return this;
  }

  /** Linear or radial gradient. direction: 'v' (top→bottom), 'u' (left→right), 'radial'. */
  gradient({ from = '#000000', to = '#ffffff', direction = 'v', amount = 1, mode = 'normal', center = [0.5, 0.5], start = 0, end = 1 } = {}) {
    const a = this._rgb(from);
    const c = this._rgb(to);
    const m = this._mode(mode);
    const W = this.width;
    const H = this.height;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const v = (y + 0.5) / H;
        let t = direction === 'u' ? u : direction === 'radial' ? Math.hypot(u - center[0], v - center[1]) * 2 : v;
        t = clamp01((t - start) / Math.max(1e-6, end - start));
        this._blendAt((y * W + x) * 4, a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t, amount, m);
      }
    }
    return this;
  }

  /** Axis-aligned rectangle in UV units. `soft` blurs the edge (UV units). */
  rect(u0, v0, u1, v1, color, { alpha = 1, mode = 'normal', soft = 0 } = {}) {
    const [r, g, b] = this._rgb(color);
    const m = this._mode(mode);
    const W = this.width;
    const H = this.height;
    const aa = Math.max(soft, 0.75 / Math.min(W, H));
    this._forBox(u0 - aa, v0 - aa, u1 + aa, v1 + aa, (x, y, ou, ov) => {
      const u = (x + 0.5) / W - ou;
      const v = (y + 0.5) / H - ov;
      const dx = Math.max(u0 - u, u - u1);
      const dy = Math.max(v0 - v, v - v1);
      const dist = Math.max(dx, dy);
      const cov = 1 - smoothstep(-aa * 0.5, aa * 0.5, dist);
      this._blendAt((y * W + x) * 4, r, g, b, cov * alpha, m);
    });
    return this;
  }

  /** Circle centered at (u, v) with radius in UV units of the texture width. */
  circle(u, v, radius, color, { alpha = 1, mode = 'normal', soft = 0 } = {}) {
    const [r, g, b] = this._rgb(color);
    const m = this._mode(mode);
    const W = this.width;
    const H = this.height;
    const aspect = W / H;
    const aa = Math.max(soft, 1 / W);
    const ry = radius * aspect;
    this._forBox(u - radius - aa, v - ry - aa, u + radius + aa, v + ry + aa, (x, y, ou, ov) => {
      const pu = (x + 0.5) / W - ou;
      const pv = ((y + 0.5) / H - ov) / aspect;
      const dist = Math.hypot(pu - u, pv - v / aspect) - radius;
      const cov = 1 - smoothstep(-aa * 0.5, aa * 0.5, dist);
      this._blendAt((y * W + x) * 4, r, g, b, cov * alpha, m);
    });
    return this;
  }

  /** Line segment with round caps; width in UV units of the texture width. */
  line(u0, v0, u1, v1, width, color, { alpha = 1, mode = 'normal', soft = 0 } = {}) {
    const [r, g, b] = this._rgb(color);
    const m = this._mode(mode);
    const W = this.width;
    const H = this.height;
    const aspect = W / H;
    const hw = width / 2;
    const aa = Math.max(soft, 1 / W);
    const a0 = [u0, v0 / aspect];
    const a1 = [u1, v1 / aspect];
    const pad = hw + aa;
    this._forBox(Math.min(u0, u1) - pad, Math.min(v0, v1) - pad * aspect, Math.max(u0, u1) + pad, Math.max(v0, v1) + pad * aspect, (x, y, ou, ov) => {
      const p = [(x + 0.5) / W - ou, ((y + 0.5) / H - ov) / aspect];
      const dist = distToSegment(p, a0, a1) - hw;
      const cov = 1 - smoothstep(-aa * 0.5, aa * 0.5, dist);
      this._blendAt((y * W + x) * 4, r, g, b, cov * alpha, m);
    });
    return this;
  }

  /** Repeating stripes across `axis` ('u' = vertical stripes, 'v' = horizontal stripes). */
  stripes({ count = 8, axis = 'u', width = 0.5, color = '#000000', alpha = 1, angle = 0, mode = 'normal', soft = 0.02 } = {}) {
    const [r, g, b] = this._rgb(color);
    const m = this._mode(mode);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    this.map((p) => {
      const base = axis === 'u' ? p.u : p.v;
      const other = axis === 'u' ? p.v : p.u;
      const s = (base * ca + other * sa) * count;
      const f = s - Math.floor(s);
      const dist = Math.abs(f - 0.5) - width / 2;
      const cov = 1 - smoothstep(-soft, soft, dist);
      this._blendAt((p.y * this.width + p.x) * 4, r, g, b, cov * alpha, m);
      return null;
    });
    return this;
  }

  /** Checkerboard. */
  checker({ count = 8, color = '#000000', alpha = 1, mode = 'normal' } = {}) {
    const [r, g, b] = this._rgb(color);
    const m = this._mode(mode);
    this.map((p) => {
      const on = (Math.floor(p.u * count) + Math.floor(p.v * count)) % 2 === 0;
      if (on) this._blendAt((p.y * this.width + p.x) * 4, r, g, b, alpha, m);
      return null;
    });
    return this;
  }

  /**
   * Planks stacked along `axis` ('v' = horizontal boards stacked vertically).
   * Each plank gets a brightness variation; gaps are painted with gapColor.
   * `joints` adds staggered end joints per plank row.
   */
  planks({ count = 4, axis = 'v', gap = 0.012, gapColor = '#1b120b', vary = 0.12, joints = 0, seed, gapAlpha = 1 } = {}) {
    const rng = createRng(this._seed(seed));
    const shades = Array.from({ length: count }, () => 1 + rng.jitter(vary));
    const offsets = Array.from({ length: count }, () => rng.float());
    const [gr, gg, gb] = this._rgb(gapColor);
    const W = this.width;
    const H = this.height;
    const d = this.data;
    const aaPx = 1 / Math.min(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const v = (y + 0.5) / H;
        const across = axis === 'v' ? v : u;
        const along = axis === 'v' ? u : v;
        const s = across * count;
        const idx = Math.min(count - 1, Math.floor(s));
        const f = s - idx;
        const i = (y * W + x) * 4;
        const k = shades[idx];
        d[i] = clamp01(d[i] * k);
        d[i + 1] = clamp01(d[i + 1] * k);
        d[i + 2] = clamp01(d[i + 2] * k);
        const distAcross = Math.min(f, 1 - f) / count;
        let gapCov = 1 - smoothstep(gap / 2 - aaPx, gap / 2 + aaPx, distAcross);
        if (joints > 0) {
          const js = (along + offsets[idx]) * joints;
          const jf = js - Math.floor(js);
          const distAlong = Math.min(jf, 1 - jf) / joints;
          gapCov = Math.max(gapCov, 1 - smoothstep(gap / 2 - aaPx, gap / 2 + aaPx, distAlong));
        }
        this._blendAt(i, gr, gg, gb, gapCov * gapAlpha, 'normal');
      }
    }
    return this;
  }

  /** Wood grain: warped ring lines running along `axis` ('u' = grain runs left→right). */
  grain({ color = '#3b2412', amount = 0.45, rings = 10, warp = 0.8, scale = 3, axis = 'u', fine = 0.25, seed, mode = 'normal' } = {}) {
    const n = createNoise(this._seed(seed));
    const [r, g, b] = this._rgb(color);
    const m = this._mode(mode);
    const W = this.width;
    const H = this.height;
    const per = this.tileable ? Math.max(1, Math.round(scale)) : 0;
    const ringCount = this.tileable ? Math.max(1, Math.round(rings)) : rings;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const v = (y + 0.5) / H;
        const along = axis === 'u' ? u : v;
        const across = axis === 'u' ? v : u;
        const w = per ? tileFbm(n, along * per, across * per, per, per, 3, 0.5, 2) : n.fbm2(along * scale, across * scale, { octaves: 3 });
        const ringsVal = (across + w * warp * 0.15) * ringCount;
        const f = ringsVal - Math.floor(ringsVal);
        let t = Math.pow(1 - Math.abs(f - 0.5) * 2, 6);
        const fineNoise = per
          ? tileFbm(n, along * per * 2, across * per * 24, per * 2, per * 24, 2, 0.5, 2)
          : n.fbm2(along * scale * 2, across * scale * 24, { octaves: 2 });
        t = clamp01(t + (fineNoise * 0.5 + 0.5) * fine - fine * 0.5);
        this._blendAt((y * W + x) * 4, r, g, b, t * amount, m);
      }
    }
    return this;
  }

  /** Running-bond bricks or stone blocks. Mortar width in UV units. */
  bricks({ rows = 8, cols = 4, mortar = 0.015, mortarColor = '#8a8378', vary = 0.12, offset = 0.5, seed, jitterColor = null } = {}) {
    const rng = createRng(this._seed(seed));
    const shades = new Map();
    const tint = jitterColor ? this._rgb(jitterColor) : null;
    const [mr, mg, mb] = this._rgb(mortarColor);
    const W = this.width;
    const H = this.height;
    const d = this.data;
    const aa = 1 / Math.min(W, H);
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      const row = Math.min(rows - 1, Math.floor(v * rows));
      const fv = v * rows - row;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const uu = u * cols + (row % 2) * offset;
        const col = Math.floor(uu);
        const fu = uu - col;
        const key = `${row}:${((col % cols) + cols) % cols}`;
        if (!shades.has(key)) shades.set(key, [1 + rng.jitter(vary), rng.float()]);
        const [k, mixT] = shades.get(key);
        const i = (y * W + x) * 4;
        d[i] = clamp01(d[i] * k);
        d[i + 1] = clamp01(d[i + 1] * k);
        d[i + 2] = clamp01(d[i + 2] * k);
        if (tint) this._blendAt(i, tint[0], tint[1], tint[2], mixT * 0.35, 'normal');
        const du = Math.min(fu, 1 - fu) / cols;
        const dv = Math.min(fv, 1 - fv) / rows;
        const dist = Math.min(du, dv);
        const cov = 1 - smoothstep(mortar / 2 - aa, mortar / 2 + aa, dist);
        this._blendAt(i, mr, mg, mb, cov, 'normal');
      }
    }
    return this;
  }

  /** Square tiles with gaps. */
  tiles({ count = 4, gap = 0.01, gapColor = '#444444', vary = 0.08, seed } = {}) {
    return this.bricks({ rows: count, cols: count, mortar: gap, mortarColor: gapColor, vary, offset: 0, seed });
  }

  /** Thin random scratches. length/width in UV units. */
  scratches({ count = 30, length = [0.03, 0.15], width = 0.002, color = '#ffffff', alpha = 0.35, angle = null, seed, mode = 'normal' } = {}) {
    const rng = createRng(this._seed(seed));
    for (let s = 0; s < count; s++) {
      const u = rng.float();
      const v = rng.float();
      const len = rng.range(length[0], length[1]);
      const a = angle ? rng.range(angle[0], angle[1]) : rng.range(0, Math.PI);
      this.line(u, v, u + Math.cos(a) * len, v + Math.sin(a) * len, width * rng.range(0.6, 1.4), color, { alpha: alpha * rng.range(0.5, 1), mode });
    }
    return this;
  }

  /** Soft irregular blotches (water stains, dirt, discoloration). */
  stains({ count = 6, radius = [0.04, 0.16], color = '#000000', alpha = 0.25, seed, mode = 'normal' } = {}) {
    const rng = createRng(this._seed(seed));
    const n = createNoise(rng.int(0, 1e9));
    const [r, g, b] = this._rgb(color);
    const m = this._mode(mode);
    const W = this.width;
    const H = this.height;
    for (let s = 0; s < count; s++) {
      const cu = rng.float();
      const cv = rng.float();
      const rad = rng.range(radius[0], radius[1]);
      const strength = alpha * rng.range(0.5, 1);
      this._forBox(cu - rad * 1.5, cv - rad * 1.5, cu + rad * 1.5, cv + rad * 1.5, (x, y, ou, ov) => {
        const u = (x + 0.5) / W - ou;
        const v = (y + 0.5) / H - ov;
        const dist = Math.hypot(u - cu, v - cv) / rad;
        const wobble = n.fbm2(u * 12 + s * 7.3, v * 12, { octaves: 3 }) * 0.45;
        const t = 1 - smoothstep(0.55, 1.05, dist + wobble);
        this._blendAt((y * W + x) * 4, r, g, b, t * strength, m);
      });
    }
    return this;
  }

  /** Rust patches: noise-thresholded areas with a darker core and orange rim. */
  rust({ amount = 0.45, scale = 5, color = '#7b3a1a', rim = '#b0581f', seed, softness = 0.06 } = {}) {
    const n = createNoise(this._seed(seed));
    const core = this._rgb(color);
    const edge = this._rgb(rim);
    const per = this.tileable ? Math.max(1, Math.round(scale)) : 0;
    const threshold = 1 - amount;
    this.map((p) => {
      const val = per ? tileFbm(n, p.u * per, p.v * per, per, per, 5, 0.55, 2) : n.fbm2(p.u * scale, p.v * scale, { octaves: 5, gain: 0.55 });
      const t = (val + 1) / 2;
      const mask = smoothstep(threshold - softness, threshold + softness, t);
      if (mask <= 0) return null;
      const rimT = 1 - smoothstep(threshold, threshold + softness * 3, t);
      const cr = core[0] + (edge[0] - core[0]) * rimT;
      const cg = core[1] + (edge[1] - core[1]) * rimT;
      const cb = core[2] + (edge[2] - core[2]) * rimT;
      const i = (p.y * this.width + p.x) * 4;
      this._blendAt(i, cr, cg, cb, mask, 'normal');
      return null;
    });
    return this;
  }

  /** Grime that accumulates toward one side ('bottom' | 'top' | 'none') plus noise. */
  dirt({ color = '#2a2218', amount = 0.4, scale = 6, from = 'bottom', seed, mode = 'multiply' } = {}) {
    const n = createNoise(this._seed(seed));
    const [r, g, b] = this._rgb(color);
    const m = this._mode(mode);
    const per = this.tileable ? Math.max(1, Math.round(scale)) : 0;
    this.map((p) => {
      const val = per ? tileFbm(n, p.u * per, p.v * per, per, per, 4, 0.5, 2) : n.fbm2(p.u * scale, p.v * scale, { octaves: 4 });
      let t = clamp01((val + 1) / 2);
      if (from === 'bottom') t *= smoothstep(0.2, 1, p.v);
      else if (from === 'top') t *= smoothstep(0.8, 0, p.v);
      this._blendAt((p.y * this.width + p.x) * 4, r, g, b, t * amount, m);
      return null;
    });
    return this;
  }

  /** Darken/lighten a band along the inside edges of a UV rect (default: whole texture). */
  edges({ width = 0.03, color = '#000000', alpha = 0.4, rect = [0, 0, 1, 1], mode = 'normal' } = {}) {
    const [r, g, b] = this._rgb(color);
    const m = this._mode(mode);
    const [u0, v0, u1, v1] = rect;
    this.map((p) => {
      if (p.u < u0 || p.u > u1 || p.v < v0 || p.v > v1) return null;
      const dist = Math.min(p.u - u0, u1 - p.u, p.v - v0, v1 - p.v);
      const t = 1 - smoothstep(0, width, dist);
      this._blendAt((p.y * this.width + p.x) * 4, r, g, b, t * alpha, m);
      return null;
    });
    return this;
  }

  /** Panel seams: outlines of UV rects, or a grid of [nx, ny] panels. */
  panelLines({ rects = null, grid = null, width = 0.004, color = '#111111', alpha = 0.85, highlight = null } = {}) {
    const list = rects ? rects.slice() : [];
    if (grid) {
      const [nx, ny] = grid;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) list.push([i / nx, j / ny, (i + 1) / nx, (j + 1) / ny]);
    }
    for (const [u0, v0, u1, v1] of list) {
      this.line(u0, v0, u1, v0, width, color, { alpha });
      this.line(u1, v0, u1, v1, width, color, { alpha });
      this.line(u1, v1, u0, v1, width, color, { alpha });
      this.line(u0, v1, u0, v0, width, color, { alpha });
      if (highlight) {
        const o = width * 1.2;
        this.line(u0 + o, v0 + o, u1 - o, v0 + o, width * 0.6, highlight, { alpha: alpha * 0.5 });
        this.line(u0 + o, v0 + o, u0 + o, v1 - o, width * 0.6, highlight, { alpha: alpha * 0.5 });
      }
    }
    return this;
  }

  /** Rivet dots with a small highlight. points: [[u, v], ...] */
  rivets({ points = [], radius = 0.008, color = '#555555', highlight = '#ffffff', shadow = '#000000' } = {}) {
    for (const [u, v] of points) {
      this.circle(u + radius * 0.25, v + radius * 0.25, radius * 1.05, shadow, { alpha: 0.35 });
      this.circle(u, v, radius, color);
      this.circle(u - radius * 0.3, v - radius * 0.3, radius * 0.35, highlight, { alpha: 0.5 });
    }
    return this;
  }

  /** Separable box blur (radius in pixels), wraps when tileable. */
  blur(radius = 1) {
    const r = Math.max(1, Math.round(radius));
    const W = this.width;
    const H = this.height;
    const src = this.data;
    const tmp = new Float32Array(src.length);
    const wrapX = (x) => (this.tileable ? ((x % W) + W) % W : Math.min(W - 1, Math.max(0, x)));
    const wrapY = (y) => (this.tileable ? ((y % H) + H) % H : Math.min(H - 1, Math.max(0, y)));
    const n = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sr = 0; let sg = 0; let sb = 0; let sa = 0;
        for (let k = -r; k <= r; k++) {
          const i = (y * W + wrapX(x + k)) * 4;
          sr += src[i]; sg += src[i + 1]; sb += src[i + 2]; sa += src[i + 3];
        }
        const o = (y * W + x) * 4;
        tmp[o] = sr / n; tmp[o + 1] = sg / n; tmp[o + 2] = sb / n; tmp[o + 3] = sa / n;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sr = 0; let sg = 0; let sb = 0; let sa = 0;
        for (let k = -r; k <= r; k++) {
          const i = (wrapY(y + k) * W + x) * 4;
          sr += tmp[i]; sg += tmp[i + 1]; sb += tmp[i + 2]; sa += tmp[i + 3];
        }
        const o = (y * W + x) * 4;
        src[o] = sr / n; src[o + 1] = sg / n; src[o + 2] = sb / n; src[o + 3] = sa / n;
      }
    }
    return this;
  }

  /** Brightness (-1..1), contrast (×), saturation (×) and gamma adjustments. */
  levels({ brightness = 0, contrast = 1, saturation = 1, gamma = 1 } = {}) {
    this.map((p) => {
      let { r, g, b } = p;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * saturation;
      g = l + (g - l) * saturation;
      b = l + (b - l) * saturation;
      r = (r - 0.5) * contrast + 0.5 + brightness;
      g = (g - 0.5) * contrast + 0.5 + brightness;
      b = (b - 0.5) * contrast + 0.5 + brightness;
      if (gamma !== 1) {
        r = Math.pow(clamp01(r), 1 / gamma);
        g = Math.pow(clamp01(g), 1 / gamma);
        b = Math.pow(clamp01(b), 1 / gamma);
      }
      return [r, g, b];
    });
    return this;
  }

  /**
   * Paint inside a sub-rectangle with local UVs (0..1 inside the rect).
   * rect: pixel rect {x, y, w, h} (as returned by an atlas layout) or UV rect [u0, v0, u1, v1].
   */
  clip(rect, fn) {
    const px = Array.isArray(rect)
      ? {
          x: Math.round(rect[0] * this.width),
          y: Math.round(rect[1] * this.height),
          w: Math.max(1, Math.round((rect[2] - rect[0]) * this.width)),
          h: Math.max(1, Math.round((rect[3] - rect[1]) * this.height)),
        }
      : rect;
    const sub = new TexturePainter(px.w, px.h, { space: this.space, layout: 'atlas', tileable: false, seed: this._seed() });
    sub.name = `${this.name}/clip`;
    for (let y = 0; y < px.h; y++) {
      for (let x = 0; x < px.w; x++) {
        const si = ((px.y + y) * this.width + (px.x + x)) * 4;
        const di = (y * px.w + x) * 4;
        sub.data[di] = this.data[si];
        sub.data[di + 1] = this.data[si + 1];
        sub.data[di + 2] = this.data[si + 2];
        sub.data[di + 3] = this.data[si + 3];
      }
    }
    fn(sub);
    for (let y = 0; y < px.h; y++) {
      for (let x = 0; x < px.w; x++) {
        const si = (y * px.w + x) * 4;
        const di = ((px.y + y) * this.width + (px.x + x)) * 4;
        this.data[di] = sub.data[si];
        this.data[di + 1] = sub.data[si + 1];
        this.data[di + 2] = sub.data[si + 2];
        this.data[di + 3] = sub.data[si + 3];
      }
    }
    return this;
  }

  /** Copy of this painter. */
  clone(name) {
    const c = new TexturePainter(this.width, this.height, { space: this.space, layout: this.layout, tileable: this.tileable, seed: this.seed, name: name || `${this.name}-copy` });
    c.data.set(this.data);
    c.hasAO = this.hasAO;
    return c;
  }

  /** Luminance at pixel (x, y), wrapping when tileable. */
  lumAt(x, y) {
    const W = this.width;
    const H = this.height;
    const xx = this.tileable ? ((x % W) + W) % W : Math.min(W - 1, Math.max(0, x));
    const yy = this.tileable ? ((y % H) + H) % H : Math.min(H - 1, Math.max(0, y));
    const i = (yy * W + xx) * 4;
    return 0.2126 * this.data[i] + 0.7152 * this.data[i + 1] + 0.0722 * this.data[i + 2];
  }

  /** 8-bit RGBA pixels (row 0 = top). */
  toBytes() {
    const out = new Uint8Array(this.width * this.height * 4);
    const d = this.data;
    for (let i = 0; i < d.length; i++) out[i] = Math.round(clamp01(d[i]) * 255);
    return out;
  }

  /**
   * THREE.DataTexture for use in k.mat.pbr(). Cached: calling twice returns the same texture.
   * @param {{wrap?: 'repeat'|'clamp'|'mirror', filter?: 'linear'|'nearest'}} [opts]
   */
  toTexture({ wrap, filter = 'linear' } = {}) {
    if (this._texture) return this._texture;
    const bytes = this.toBytes();
    const tex = new THREE.DataTexture(bytes, this.width, this.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    const w = wrap || (this.layout === 'atlas' ? 'clamp' : 'repeat');
    const wrapMode = w === 'clamp' ? THREE.ClampToEdgeWrapping : w === 'mirror' ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
    tex.wrapS = wrapMode;
    tex.wrapT = wrapMode;
    tex.magFilter = filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    tex.minFilter = filter === 'nearest' ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.flipY = false;
    tex.colorSpace = this.space === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.name = this.name;
    tex.needsUpdate = true;
    tex.userData.studio = {
      kitTexture: true,
      name: this.name,
      space: this.space,
      layout: this.layout,
      tileable: this.tileable,
      width: this.width,
      height: this.height,
      hasAO: this.hasAO,
      wrap: w,
      filter,
    };
    this._texture = tex;
    return tex;
  }
}

function distToSegment(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
}

/** fBm that tiles with independent integer periods px, py. */
function tileFbm(n, x, y, px, py, octaves, gain, lacunarity) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n.perlin2(x * freq, y * freq, Math.round(px * freq), Math.round(py * freq));
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged fBm in [0, 1] that tiles with integer periods px, py. */
function tileRidged(n, x, y, px, py, octaves, gain, lacunarity) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const v = 1 - Math.abs(n.perlin2(x * freq, y * freq, Math.round(px * freq), Math.round(py * freq)));
    sum += amp * v * v;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Create a painter. */
export function createTexture(width, height = width, opts = {}) {
  return new TexturePainter(width, height, opts);
}

/**
 * Tangent-space normal map (OpenGL / glTF convention: +X right, +Y up) from a height painter.
 * Brighter height = raised. strength scales the slope.
 */
export function normalFromHeight(height, { strength = 2, name } = {}) {
  const W = height.width;
  const H = height.height;
  const out = new TexturePainter(W, H, { space: 'linear', layout: height.layout, tileable: height.tileable, name: name || `${height.name}-normal` });
  const s = strength * (Math.max(W, H) / 256);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (height.lumAt(x + 1, y) - height.lumAt(x - 1, y)) * 0.5;
      const dyDown = (height.lumAt(x, y + 1) - height.lumAt(x, y - 1)) * 0.5;
      // Image y grows downward; glTF normal +Y points up in the image.
      let nx = -dx * s;
      let ny = dyDown * s;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * W + x) * 4;
      out.data[i] = nx * 0.5 + 0.5;
      out.data[i + 1] = ny * 0.5 + 0.5;
      out.data[i + 2] = nz * 0.5 + 0.5;
      out.data[i + 3] = 1;
    }
  }
  return out;
}

/**
 * Pack occlusion (R), roughness (G) and metalness (B) into one linear texture, the glTF layout.
 * Each input is a number (constant) or a painter (its luminance is used).
 */
export function packORM({ ao = null, roughness = 0.6, metalness = 0, width, height, name, layout, tileable } = {}) {
  const sources = [ao, roughness, metalness].filter((s) => s && typeof s === 'object');
  const W = width || sources[0]?.width || 256;
  const H = height || sources[0]?.height || W;
  const ref = sources[0];
  const out = new TexturePainter(W, H, {
    space: 'linear',
    layout: layout || ref?.layout || 'tiling',
    tileable: tileable ?? ref?.tileable ?? true,
    name: name || 'orm',
  });
  const sample = (src, x, y, fallback) => {
    if (src === null || src === undefined) return fallback;
    if (typeof src === 'number') return src;
    if (src.width !== W || src.height !== H) throw new Error(`k.tex.orm: all painters must be ${W}x${H} (got ${src.width}x${src.height} for ${src.name})`);
    return src.lumAt(x, y);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      out.data[i] = sample(ao, x, y, 1);
      out.data[i + 1] = sample(roughness, x, y, 0.6);
      out.data[i + 2] = sample(metalness, x, y, 0);
      out.data[i + 3] = 1;
    }
  }
  out.hasAO = ao !== null && ao !== undefined;
  return out;
}
