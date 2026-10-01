// Color helpers. Authoring colors are sRGB (what you pick in a color picker);
// THREE.Color stores linear values internally and the exporter writes linear factors,
// exactly as glTF requires.

import * as THREE from 'three';

/**
 * Parse an authoring color into a THREE.Color (linear working space).
 * Accepts '#rrggbb', CSS color names, 0xrrggbb, [r, g, b] in sRGB 0..1, or a THREE.Color.
 * @returns {THREE.Color}
 */
export function toColor(input) {
  if (input instanceof THREE.Color) return input.clone();
  if (typeof input === 'string' || typeof input === 'number') return new THREE.Color(input);
  if (Array.isArray(input) && input.length >= 3) {
    return new THREE.Color().setRGB(input[0], input[1], input[2], THREE.SRGBColorSpace);
  }
  throw new Error(`color: cannot parse ${JSON.stringify(input)} (use '#rrggbb', 0xrrggbb or [r,g,b] sRGB 0..1)`);
}

/** sRGB components [r, g, b] in 0..1 for any accepted color input. */
export function toSRGB(input) {
  const c = toColor(input);
  const out = { r: 0, g: 0, b: 0 };
  c.getRGB(out, THREE.SRGBColorSpace);
  return [out.r, out.g, out.b];
}

/** '#rrggbb' (sRGB) for any accepted color input. */
export function toHex(input) {
  return `#${toColor(input).getHexString(THREE.SRGBColorSpace)}`;
}

/** Mix two colors in sRGB space (perceptually closer to what artists expect). */
export function mix(a, b, t) {
  const ca = toSRGB(a);
  const cb = toSRGB(b);
  return new THREE.Color().setRGB(
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
    THREE.SRGBColorSpace,
  );
}

/** Lighten (amount > 0) or darken (amount < 0) in HSL lightness, amount in -1..1. */
export function shade(input, amount) {
  const c = toColor(input);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  hsl.l = Math.min(1, Math.max(0, hsl.l + amount));
  return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l, THREE.SRGBColorSpace);
}

/** Adjust saturation by amount in -1..1. */
export function saturate(input, amount) {
  const c = toColor(input);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  hsl.s = Math.min(1, Math.max(0, hsl.s + amount));
  return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l, THREE.SRGBColorSpace);
}

/** Color from HSL (h in 0..360, s and l in 0..1), sRGB. */
export function hsl(h, s, l) {
  return new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l, THREE.SRGBColorSpace);
}

/** Relative luminance of an sRGB color (0..1), useful for contrast decisions. */
export function luminance(input) {
  const c = toColor(input);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export const color = Object.assign((input) => toColor(input), {
  parse: toColor,
  srgb: toSRGB,
  hex: toHex,
  mix,
  shade,
  saturate,
  hsl,
  luminance,
});
