import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { k } from '../studio/kit/index.js';
import { createRng } from '../studio/kit/rng.js';
import { createNoise } from '../studio/kit/noise.js';

test('rng is deterministic and named streams are independent', () => {
  const a = createRng(42);
  const b = createRng(42);
  assert.deepEqual([a.float(), a.float(), a.int(1, 6)], [b.float(), b.float(), b.int(1, 6)]);
  const s1 = createRng(7).stream('planks');
  const s2 = createRng(7).stream('planks');
  const s3 = createRng(7).stream('hoops');
  const v1 = s1.float();
  assert.equal(v1, s2.float());
  assert.notEqual(v1, s3.float());
});

test('periodic noise tiles exactly at its period', () => {
  const n = createNoise(3);
  for (const [x, y] of [[0.3, 0.7], [1.9, 2.2], [3.5, 0.1]]) {
    assert.ok(Math.abs(n.perlin2(x, y, 4, 4) - n.perlin2(x + 4, y + 4, 4, 4)) < 1e-9);
  }
});

test('tileable painter textures match across opposite edges', () => {
  const t = k.tex.create(64, 64, { seed: 5 }).fill('#808080').noise({ color: '#000000', scale: 4, amount: 1 });
  let maxDiff = 0;
  for (let y = 0; y < 64; y++) {
    const left = t.data[(y * 64) * 4];
    const right = t.data[(y * 64 + 63) * 4];
    maxDiff = Math.max(maxDiff, Math.abs(left - right));
  }
  assert.ok(maxDiff < 0.08, `edge mismatch ${maxDiff}`);
});

test('normalFromHeight follows the OpenGL convention (+Y up in the image)', () => {
  // Height increases downward in the image (toward larger v): the surface faces up the image (+Y).
  const h = k.tex.create(16, 16, { space: 'linear', tileable: false }).map((p) => [p.v, p.v, p.v]);
  const n = k.tex.normalFromHeight(h, { strength: 64 });
  const i = (8 * 16 + 8) * 4;
  assert.ok(n.data[i + 1] > 0.55, `green ${n.data[i + 1]}`);
  assert.ok(Math.abs(n.data[i] - 0.5) < 0.02);
});

test('lieAlong is a rotation that puts the lathe front (+Z) on top', () => {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]);
  k.op.lieAlong(g, 'x');
  const p = g.attributes.position;
  assert.deepEqual([p.getX(0), p.getY(0), p.getZ(0)].map(Math.round), [1, 0, 0]); // axis → +X
  assert.deepEqual([p.getX(1), p.getY(1), p.getZ(1)].map(Math.round), [0, 1, 0]); // front → up
});

test('mirror keeps faces pointing outward (winding fixed)', () => {
  const g = k.op.mirror(k.geo.box(1, 1, 1), 'x');
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  for (let v = 0; v < pos.count; v += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, v);
    const b = new THREE.Vector3().fromBufferAttribute(pos, v + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, v + 2);
    const face = b.sub(a).cross(c.sub(a));
    assert.ok(face.dot(new THREE.Vector3().fromBufferAttribute(nrm, v)) > 0);
  }
});

test('crease keeps correct normals on tiny geometry (1 cm rivets)', () => {
  const g = k.geo.sphere(0.008, { widthSegments: 8, heightSegments: 6 });
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  for (let v = 0; v < pos.count; v++) {
    const p = new THREE.Vector3().fromBufferAttribute(pos, v).normalize();
    assert.ok(p.dot(new THREE.Vector3().fromBufferAttribute(nrm, v)) > 0.7);
  }
});

test('atlas packing keeps the requested padding between charts', () => {
  const a = k.uv.unwrap(k.geo.box(1, 1, 1));
  const b = k.uv.unwrap(k.geo.box(0.5, 2, 0.5));
  const layout = k.uv.atlas({ a, b }, { size: 512, padding: 12 });
  const rects = layout.charts.map((c) => c.rect);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const r = rects[i];
      const s = rects[j];
      const gapX = Math.max(s.x - (r.x + r.w), r.x - (s.x + s.w));
      const gapY = Math.max(s.y - (r.y + r.h), r.y - (s.y + s.h));
      assert.ok(Math.max(gapX, gapY) >= 12, `charts ${i},${j} gap ${Math.max(gapX, gapY)}`);
    }
  }
});

test('materials reject non-portable options', () => {
  assert.throws(() => k.mat.pbr({ side: 2 }), /double-sided/);
  assert.throws(() => k.mat.pbr({ shininess: 3 }), /unknown option/);
  assert.throws(() => k.mat.pbr({ opacity: 0.5 }), /blend/);
});
