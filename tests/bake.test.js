import { test } from 'node:test';
import assert from 'node:assert/strict';
import { k } from '../studio/kit/index.js';

function atlasBox(size = 128) {
  const g = k.uv.unwrap(k.geo.box(0.2, 0.1, 0.3));
  const layout = k.uv.atlas({ box: g }, { size, padding: 6 });
  return { g, layout };
}

test('surface bake covers the islands, fills gutters and is cached by content', () => {
  const { g } = atlasBox();
  const bake = k.bake.surface({ box: g });
  assert.equal(bake.width, 128);
  assert.ok(bake.coverage > 0.2 && bake.coverage < 0.95, `coverage ${bake.coverage}`);
  let gutter = 0;
  for (const m of bake.mask) if (m === 2) gutter++;
  assert.ok(gutter > 0, 'gutter texels are filled');
  // Every covered texel lies on the box surface.
  for (let i = 0; i < bake.mask.length; i++) {
    if (bake.mask[i] !== 1) continue;
    const [x, y, z] = [bake.pos[i * 3], bake.pos[i * 3 + 1], bake.pos[i * 3 + 2]];
    const onFace = Math.abs(Math.abs(x) - 0.1) < 1e-4 || Math.abs(Math.abs(y) - 0.05) < 1e-4 || Math.abs(Math.abs(z) - 0.15) < 1e-4;
    assert.ok(onFace, `texel ${i} at ${x},${y},${z} is not on the box`);
  }
  const again = k.bake.surface({ box: atlasBox().g });
  assert.equal(again.mask, bake.mask, 'same geometry content reuses the rasterized core');
  assert.notEqual(again, bake, 'each call gets its own view (edge/AO state never leaks between builds)');
});

test('edge mask is high on box edges and zero in face centers; cavity finds concave edges', () => {
  const { g } = atlasBox(256);
  const bake = k.bake.surface({ box: g }).edges({ width: 0.01 });
  let nearEdge = 0;
  let nearEdgeHigh = 0;
  let center = 0;
  let centerHigh = 0;
  for (let i = 0; i < bake.mask.length; i++) {
    if (bake.mask[i] !== 1) continue;
    const [x, y, z] = [bake.pos[i * 3], bake.pos[i * 3 + 1], bake.pos[i * 3 + 2]];
    const dx = 0.1 - Math.abs(x);
    const dy = 0.05 - Math.abs(y);
    const dz = 0.15 - Math.abs(z);
    const sorted = [dx, dy, dz].sort((a, b) => a - b);
    const distToEdge = sorted[1]; // on a face one distance is 0; the next smallest is the edge distance
    if (distToEdge < 0.002) {
      nearEdge++;
      if (bake.edge[i] > 0.6) nearEdgeHigh++;
    } else if (distToEdge > 0.02) {
      center++;
      if (bake.edge[i] > 0) centerHigh++;
    }
    assert.equal(bake.cavity[i], 0, 'a box has no concave edges');
  }
  assert.ok(nearEdge > 50 && nearEdgeHigh / nearEdge > 0.95, `edge texels ${nearEdgeHigh}/${nearEdge}`);
  assert.equal(centerHigh, 0, `face centers stay clean (${centerHigh}/${center})`);

  // An L-shaped extrusion has one concave edge.
  const l = k.uv.unwrap(k.geo.extrude(k.shape.polygon([[0, 0], [0.2, 0], [0.2, 0.05], [0.05, 0.05], [0.05, 0.2], [0, 0.2]]), 0.1, { axis: 'z' }));
  k.uv.atlas({ l }, { size: 256, padding: 6 });
  const lb = k.bake.surface({ l }).edges({ width: 0.008 });
  let concave = 0;
  for (let i = 0; i < lb.mask.length; i++) if (lb.mask[i] === 1 && lb.cavity[i] > 0.5) concave++;
  assert.ok(concave > 10, `concave texels ${concave}`);
});

test('3D patterns give the same color on both sides of a UV seam', () => {
  const { g } = atlasBox(256);
  const bake = k.bake.surface({ box: g });
  const camo = k.tex.pattern.camo({ colors: ['#55603a', '#2f3422', '#7a6a48'], scale: 0.05, seed: 3 });
  // Texels from different charts (faces) that are within a few mm in 3D (i.e. along a box edge)
  // must agree on the camo layer almost always: the pattern is volumetric.
  const pts = [];
  for (let i = 0; i < bake.mask.length; i++) if (bake.mask[i] === 1) pts.push(i);
  const p = (i) => ({ pos: [bake.pos[i * 3], bake.pos[i * 3 + 1], bake.pos[i * 3 + 2]], normal: [bake.normal[i * 3], bake.normal[i * 3 + 1], bake.normal[i * 3 + 2]] });
  const buckets = new Map();
  const cell = 0.004;
  for (const i of pts) {
    const q = p(i).pos.map((v) => Math.floor(v / cell)).join(',');
    if (!buckets.has(q)) buckets.set(q, []);
    buckets.get(q).push(i);
  }
  let pairs = 0;
  let same = 0;
  for (const list of buckets.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const na = p(list[a]).normal;
        const nb = p(list[b]).normal;
        if (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] > 0.5) continue; // same face
        pairs++;
        if (camo.index(p(list[a])) === camo.index(p(list[b]))) same++;
      }
    }
  }
  assert.ok(pairs > 20, `seam pairs ${pairs}`);
  assert.ok(same / pairs > 0.85, `camo agrees across seams ${same}/${pairs}`);
});

test('paint3d is deterministic and only touches baked texels', () => {
  const { g } = atlasBox(128);
  const paint = () => {
    const bake = k.bake.surface({ box: g }).edges({ width: 0.006 });
    const t = k.tex.create(128, 128, { layout: 'atlas', name: 'p3d' }).fill('#000000');
    const camo = k.tex.pattern.digital({ colors: ['#6b7a4a', '#3b4529', '#a39466'], cell: 0.01, seed: 2 });
    t.paint3d(bake, camo);
    t.paint3d(bake, (p) => (p.edge > 0 ? [1, 1, 1] : null), { alpha: 0.5 });
    return t.toBytes();
  };
  const a = paint();
  const b = paint();
  assert.deepEqual(a, b);
  const bake = k.bake.surface({ box: g });
  for (let i = 0; i < bake.mask.length; i++) {
    if (bake.mask[i]) continue;
    assert.deepEqual([...a.subarray(i * 4, i * 4 + 3)], [0, 0, 0], 'texels outside the bake keep the fill');
  }
  for (const name of ['camo', 'digital', 'tiger', 'hex', 'carbon', 'brushed']) {
    const opts = name === 'brushed' ? { color: '#c0c0c0' } : name === 'carbon' ? {} : { colors: ['#111111', '#777777', '#eeeeee'] };
    const f = k.tex.pattern[name](opts);
    const c = f({ pos: [0.01, 0.02, 0.03], normal: [0, 0, 1] });
    assert.equal(c.length, 3, name);
    assert.ok(c.every((v) => v >= 0 && v <= 1), `${name} returns sRGB 0..1`);
  }
});

test('ambient occlusion darkens the inside corner of an L shape', () => {
  const l = k.uv.unwrap(k.geo.extrude(k.shape.polygon([[0, 0], [0.2, 0], [0.2, 0.05], [0.05, 0.05], [0.05, 0.2], [0, 0.2]]), 0.1, { axis: 'z' }));
  k.uv.atlas({ l }, { size: 128, padding: 6 });
  const bake = k.bake.surface({ l }).ao({ samples: 16, distance: 0.08, size: 64 });
  let corner = 0;
  let cornerN = 0;
  let open = 0;
  let openN = 0;
  for (let i = 0; i < bake.mask.length; i++) {
    if (bake.mask[i] !== 1) continue;
    const [x, y] = [bake.pos[i * 3], bake.pos[i * 3 + 1]];
    if (x > 0.05 && x < 0.08 && Math.abs(y - 0.05) < 1e-4) {
      corner += bake.aoMap[i];
      cornerN++;
    }
    if (x > 0.17 && Math.abs(y) < 1e-4) {
      open += bake.aoMap[i];
      openN++;
    }
  }
  assert.ok(cornerN > 0 && openN > 0);
  assert.ok(corner / cornerN < open / openN - 0.15, `corner ${corner / cornerN} vs open ${open / openN}`);
});
