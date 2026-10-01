// RGBA8 pixel helpers used by profile transforms (lossless where possible).

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const LUT_TO_LINEAR = new Float32Array(256).map((_, i) => srgbToLinear(i / 255));

export function nextPOT(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Repeat an image nu × nv times. */
export function tileImage(src, w, h, nu, nv) {
  const W = w * nu;
  const H = h * nv;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = y % h;
    for (let x = 0; x < W; x++) {
      const sx = x % w;
      const si = (sy * w + sx) * 4;
      const di = (y * W + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return { data: out, width: W, height: H };
}

/**
 * Area-average resize. sRGB images are averaged in linear light (correct downsampling);
 * normal maps are renormalized.
 */
export function resizeImage(src, sw, sh, dw, dh, { space = 'linear', normal = false } = {}) {
  const out = new Uint8Array(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * fy;
    const y1 = (y + 1) * fy;
    for (let x = 0; x < dw; x++) {
      const x0 = x * fx;
      const x1 = (x + 1) * fx;
      let r = 0; let g = 0; let b = 0; let a = 0; let wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.min(sh, Math.ceil(y1)); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.min(sw, Math.ceil(x1)); sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          const wgt = wx * wy;
          const i = (sy * sw + sx) * 4;
          if (space === 'srgb') {
            r += LUT_TO_LINEAR[src[i]] * wgt;
            g += LUT_TO_LINEAR[src[i + 1]] * wgt;
            b += LUT_TO_LINEAR[src[i + 2]] * wgt;
          } else {
            r += (src[i] / 255) * wgt;
            g += (src[i + 1] / 255) * wgt;
            b += (src[i + 2] / 255) * wgt;
          }
          a += (src[i + 3] / 255) * wgt;
          wsum += wgt;
        }
      }
      r /= wsum; g /= wsum; b /= wsum; a /= wsum;
      if (space === 'srgb') {
        r = linearToSrgb(r);
        g = linearToSrgb(g);
        b = linearToSrgb(b);
      }
      if (normal) {
        let nx = r * 2 - 1; let ny = g * 2 - 1; let nz = b * 2 - 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        r = nx * 0.5 + 0.5; g = ny * 0.5 + 0.5; b = nz * 0.5 + 0.5;
      }
      const o = (y * dw + x) * 4;
      out[o] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      out[o + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      out[o + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      out[o + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
    }
  }
  return out;
}

/** Solid-color image. rgba components 0..255. */
export function solidImage(w, h, rgba) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(rgba, i * 4);
  return out;
}

export const to8 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
