// Seeded gradient noise (improved Perlin) in 2D and 3D, plus fBm, ridged and cellular
// variants. The 2D functions accept an integer period so textures can tile seamlessly.

import { hashString } from './rng.js';

function buildPermutation(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const mod = (n, m) => ((n % m) + m) % m;

const GRAD2 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
];

function grad3(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export class Noise {
  /** @param {number} seed */
  constructor(seed = 0) {
    this.seed = seed >>> 0;
    this.perm = buildPermutation(this.seed);
  }

  _g2(ix, iy, x, y) {
    const g = GRAD2[this.perm[this.perm[ix & 255] + (iy & 255)] & 7];
    return g[0] * x + g[1] * y;
  }

  /**
   * 2D gradient noise in roughly [-1, 1].
   * @param {number} px period along x (integer, 0 = no tiling)
   * @param {number} py period along y (integer, 0 = no tiling)
   */
  perlin2(x, y, px = 0, py = 0) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    let ix0 = x0;
    let iy0 = y0;
    let ix1 = x0 + 1;
    let iy1 = y0 + 1;
    if (px > 0) {
      ix0 = mod(ix0, px);
      ix1 = mod(ix1, px);
    }
    if (py > 0) {
      iy0 = mod(iy0, py);
      iy1 = mod(iy1, py);
    }
    const n00 = this._g2(ix0, iy0, fx, fy);
    const n10 = this._g2(ix1, iy0, fx - 1, fy);
    const n01 = this._g2(ix0, iy1, fx, fy - 1);
    const n11 = this._g2(ix1, iy1, fx - 1, fy - 1);
    const u = fade(fx);
    const v = fade(fy);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.42;
  }

  /** 3D improved Perlin noise in roughly [-1, 1]. */
  perlin3(x, y, z) {
    const p = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad3(p[AA], x, y, z), grad3(p[BA], x - 1, y, z), u),
        lerp(grad3(p[AB], x, y - 1, z), grad3(p[BB], x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(grad3(p[AA + 1], x, y, z - 1), grad3(p[BA + 1], x - 1, y, z - 1), u),
        lerp(grad3(p[AB + 1], x, y - 1, z - 1), grad3(p[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  }

  /**
   * Fractal Brownian motion in 2D, roughly [-1, 1].
   * When `period` > 0, (x, y) are expected in [0, period) and the result tiles.
   */
  fbm2(x, y, { octaves = 4, lacunarity = 2, gain = 0.5, period = 0 } = {}) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const p = period > 0 ? Math.round(period * freq) : 0;
      sum += amp * this.perlin2(x * freq, y * freq, p, p);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Fractal Brownian motion in 3D, roughly [-1, 1]. */
  fbm3(x, y, z, { octaves = 4, lacunarity = 2, gain = 0.5 } = {}) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.perlin3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal in [0, 1] (sharp crests, good for cracks and rock). */
  ridged2(x, y, { octaves = 4, lacunarity = 2, gain = 0.5, period = 0 } = {}) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const p = period > 0 ? Math.round(period * freq) : 0;
      const n = 1 - Math.abs(this.perlin2(x * freq, y * freq, p, p));
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  ridged3(x, y, z, { octaves = 4, lacunarity = 2, gain = 0.5 } = {}) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.perlin3(x * freq, y * freq, z * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  _cellPoint(cx, cy) {
    const h = this.perm[(this.perm[cx & 255] + (cy & 255)) & 511];
    const h2 = this.perm[(h + 101) & 511];
    return [h / 255, h2 / 255];
  }

  /**
   * Cellular (Worley) noise. Returns { f1, f2, id } where f1/f2 are distances to the
   * nearest/second-nearest feature point (in cell units) and id is a stable cell hash in [0,1).
   * `period` makes the pattern tile.
   */
  worley2(x, y, period = 0) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let f1 = Infinity;
    let f2 = Infinity;
    let id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        let cx = xi + dx;
        let cy = yi + dy;
        const wx = period > 0 ? mod(cx, period) : cx;
        const wy = period > 0 ? mod(cy, period) : cy;
        const [ox, oy] = this._cellPoint(wx, wy);
        const px = cx + ox;
        const py = cy + oy;
        const d = Math.hypot(px - x, py - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = ((wx * 73856093) ^ (wy * 19349663)) >>> 0;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return { f1, f2, id: (id % 10007) / 10007 };
  }
}

/** @param {number|string} seed */
export function createNoise(seed = 0) {
  return new Noise(typeof seed === 'string' ? hashString(seed) : Math.floor(seed));
}
