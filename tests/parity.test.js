import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { diffImages } from '../studio/core/render/image.js';

function image(color, { square = null } = {}) {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const inside = x > 16 && x < 48 && y > 16 && y < 48;
      const c = inside ? (square || color) : [0x4b, 0x50, 0x57];
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = 255;
    }
  }
  return png;
}

test('identical renders have zero parity difference', () => {
  const d = diffImages(image([200, 50, 50]), image([200, 50, 50]));
  assert.equal(d.mismatched, 0);
  assert.equal(d.ratio, 0);
});

test('a lost base color is detected as a large parity difference', () => {
  // e.g. an engine that drops baseColorFactor renders the object white
  const d = diffImages(image([200, 50, 50]), image([235, 235, 235]));
  assert.ok(d.ratio > 0.9, `ratio ${d.ratio}`);
});
