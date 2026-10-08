import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dilateAtlases } from '../studio/core/transforms/index.js';

test('atlas dilation accepts a primitive with more UV values than the argument stack limit', () => {
  const triangles = 30000;
  const uvs = new Float32Array(triangles * 6);
  for (let t = 0; t < triangles; t++) uvs.set([0.2, 0.2, 0.4, 0.2, 0.3, 0.4], t * 6);
  const texture = { id: 0, name: 'large-atlas', wrapS: 'CLAMP_TO_EDGE', wrapT: 'CLAMP_TO_EDGE', width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) };
  const ir = { textures: [texture], materials: [{ id: 0, baseColorTexture: 0 }], nodes: [{ primitives: [{ material: 0, uvs }] }], notes: [] };
  assert.doesNotThrow(() => dilateAtlases(ir));
  assert.equal(texture.data.length, 8 * 8 * 4);
});
