import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { useFixtures } from './helpers.js';

useFixtures();
const { buildItem } = await import('../studio/core/build.js');
const { withCapture } = await import('../studio/core/render/capture.js');

await buildItem({ slug: 'kit-test', profileId: 'generic' });
const glb = (api) => `${api.url}files/preview/kit-test/generic.glb`;
const decode = (dataUrl) => PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
const encode = (png) => `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;

/** Crop a PNG (rows y0..y0+h). */
function crop(png, y0, h) {
  const out = new PNG({ width: png.width, height: h });
  png.data.copy(out.data, 0, y0 * png.width * 4, (y0 + h) * png.width * 4);
  return out;
}

/** The model panel of an overlay sheet turned into a black-on-white "reference drawing". */
function silhouette(panel, { squashY = 1 } = {}) {
  const bg = [panel.data[0], panel.data[1], panel.data[2]];
  const out = new PNG({ width: panel.width, height: panel.height });
  out.data.fill(255);
  const cy = panel.height / 2;
  for (let y = 0; y < panel.height; y++) {
    const sy = Math.round(cy + (y - cy) / squashY);
    for (let x = 0; x < panel.width; x++) {
      const i = (y * panel.width + x) * 4;
      if (sy < 0 || sy >= panel.height) continue;
      const j = (sy * panel.width + x) * 4;
      const d = Math.max(...[0, 1, 2].map((c) => Math.abs(panel.data[j + c] - bg[c])));
      if (d > 6 && sy > 36) out.data.set([20, 20, 20, 255], i); // skip the panel label
    }
  }
  return out;
}

let captured = null;
const capture = () => {
  captured ??= withCapture(async (api) => {
    const parts = await api.renderParts({ slug: 'kit-test', views: ['front', 'iso'], size: 256 });
    const blueprint = await api.blueprint({ url: glb(api), views: ['front', 'top'], size: 256 });
    // First pass with a dummy reference (one dark pixel) to get the model panel.
    const dummy = new PNG({ width: 9, height: 9 });
    dummy.data.fill(255);
    dummy.data.set([0, 0, 0, 255], (4 * 9 + 4) * 4);
    const first = await api.referenceOverlay({ url: glb(api), image: encode(dummy), view: 'front', size: 512 });
    // Header 40 px, then reference / model / overlay panels of 512 × 256.
    const panel = crop(decode(first.sheet), 40 + 256, 256);
    const same = await api.referenceOverlay({ url: glb(api), image: encode(silhouette(panel)), view: 'front', size: 512 });
    const squashed = await api.referenceOverlay({ url: glb(api), image: encode(silhouette(panel, { squashY: 0.6 })), view: 'front', size: 512 });
    return { parts, blueprint, same, squashed };
  });
  return captured;
};
after(async () => {
  await captured;
});

test('parts view colors every k.part and lists it with its triangles', async () => {
  const { parts } = await capture();
  assert.ok(parts.images.front.startsWith('data:image/png'));
  assert.ok(parts.images.legend);
  assert.ok(parts.parts.length >= 1);
  for (const p of parts.parts) {
    assert.equal(typeof p.name, 'string');
    assert.ok(p.triangles > 0);
  }
});

test('blueprint reports the model dimensions in meters', async () => {
  const { blueprint } = await capture();
  assert.ok(blueprint.images.front && blueprint.images.top);
  const { front, top } = blueprint.dims;
  for (const d of [front.width, front.height, top.width, top.height]) assert.ok(d > 0);
  assert.ok(Math.abs(front.width - top.width) < 1e-3, 'front and top views share the X extent');
  assert.ok(front.grid > 0, 'grid step chosen from the size');
});

test('reference overlay: a matching drawing scores high, a squashed one much lower', async () => {
  const { same, squashed } = await capture();
  assert.ok(same.iou > 0.9, `same silhouette IoU ${same.iou}`);
  assert.ok(squashed.iou < same.iou - 0.15, `squashed IoU ${squashed.iou} vs ${same.iou}`);
});
