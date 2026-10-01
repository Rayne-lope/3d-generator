// PNG helpers for captures: data URLs, diffs and side-by-side composition (pure JS).

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { ensureDir } from '../fsutil.js';

export function dataUrlToBuffer(dataUrl) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

export function writeDataUrl(file, dataUrl) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, dataUrlToBuffer(dataUrl));
  return file;
}

export function readPNG(fileOrBuffer) {
  const buf = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : fs.readFileSync(fileOrBuffer);
  return PNG.sync.read(buf);
}

export function writePNG(file, png) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, PNG.sync.write(png));
  return file;
}

const BG = [0x4b, 0x50, 0x57];

/**
 * Compare two same-size renders. Returns the mismatch ratio relative to the object's
 * pixels (the union of non-background pixels), plus a diff image.
 */
export function diffImages(a, b, { threshold = 0.12 } = {}) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('diffImages: size mismatch');
  const { width, height } = a;
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, width, height, { threshold, includeAA: false, alpha: 0.25, diffColor: [255, 45, 85] });
  let foreground = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const fa = Math.abs(a.data[i] - BG[0]) + Math.abs(a.data[i + 1] - BG[1]) + Math.abs(a.data[i + 2] - BG[2]) > 6;
    const fb = Math.abs(b.data[i] - BG[0]) + Math.abs(b.data[i + 1] - BG[1]) + Math.abs(b.data[i + 2] - BG[2]) > 6;
    if (fa || fb) foreground++;
  }
  return { mismatched, foreground, ratio: foreground ? mismatched / foreground : 0, diff };
}

/** Place images side by side (same height) with a gap. */
export function sideBySide(images, { gap = 8, background = [29, 32, 36] } = {}) {
  const height = Math.max(...images.map((i) => i.height));
  const width = images.reduce((s, i) => s + i.width, 0) + gap * (images.length - 1);
  const out = new PNG({ width, height });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = background[0];
    out.data[i + 1] = background[1];
    out.data[i + 2] = background[2];
    out.data[i + 3] = 255;
  }
  let x0 = 0;
  for (const img of images) {
    PNG.bitblt(img, out, 0, 0, img.width, img.height, x0, 0);
    x0 += img.width + gap;
  }
  return out;
}

/** Arrange same-size images in a grid (row-major). */
export function grid(images, columns, { gap = 0, background = [29, 32, 36] } = {}) {
  const w = images[0].width;
  const h = images[0].height;
  const rows = Math.ceil(images.length / columns);
  const out = new PNG({ width: columns * w + (columns - 1) * gap, height: rows * h + (rows - 1) * gap });
  for (let i = 0; i < out.data.length; i += 4) out.data.set([...background, 255], i);
  images.forEach((img, i) => PNG.bitblt(img, out, 0, 0, w, h, (i % columns) * (w + gap), Math.floor(i / columns) * (h + gap)));
  return out;
}
