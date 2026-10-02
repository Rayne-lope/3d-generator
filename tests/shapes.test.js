import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { useFixtures, issueIds } from './helpers.js';

useFixtures();
const { k } = await import('../studio/kit/index.js');
const { buildItem } = await import('../studio/core/build.js');

const outline = (shape) => k.shape.outlinePoints(shape);
const area = (pts) => Math.abs(THREE.ShapeUtils.area(pts.map(([x, y]) => new THREE.Vector2(x, y))));
const square = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** Triangles of a geometry as [a, b, c] Vector3 triples. */
function triangles(g) {
  const q = g.index ? g.toNonIndexed() : g;
  const p = q.attributes.position;
  const out = [];
  for (let i = 0; i < p.count; i += 3) out.push([0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(p, i + j)));
  return out;
}
const triArea = ([a, b, c]) => b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
/** Signed volume (> 0 when faces point outward). */
const volume = (g) => triangles(g).reduce((s, [a, b, c]) => s + a.dot(b.clone().cross(c)) / 6, 0);

test('chamfered corners are 45° cuts of the requested size', () => {
  const pts = outline(k.shape.chamfered(square, { size: 0.2 }));
  assert.equal(pts.length, 8);
  // Each cut joins (0.2, 0) and (0, 0.2) style points: equal legs → 45°.
  assert.ok(pts.some(([x, y]) => Math.abs(x - 0.2) < 1e-9 && Math.abs(y) < 1e-9));
  assert.ok(pts.some(([x, y]) => Math.abs(x) < 1e-9 && Math.abs(y - 0.2) < 1e-9));
  assert.ok(Math.abs(area(pts) - (1 - 4 * 0.02)) < 1e-9, 'four corner triangles of 0.2 × 0.2 / 2 removed');
  // Sizes are clamped to half the shorter neighbouring edge.
  const big = outline(k.shape.chamfered(square, { size: 5 }));
  assert.ok(Math.abs(area(big) - 0.5) < 1e-9, 'clamped to a diamond');
});

test('fillets stay on a circle of the requested radius; per-corner size and style win', () => {
  const pts = outline(k.shape.rounded([[0, 0], [1, 0], [1, 1, 0.3], [0, 1, 0.2, 'chamfer']], { size: 0 }));
  const arc = pts.filter(([x, y]) => x > 0.7 && y > 0.7);
  assert.ok(arc.length >= 4, 'the fillet corner is an arc');
  for (const [x, y] of arc) assert.ok(Math.abs(Math.hypot(x - 0.7, y - 0.7) - 0.3) < 1e-9);
  assert.ok(pts.some(([x, y]) => Math.abs(x - 0.2) < 1e-9 && Math.abs(y - 1) < 1e-9), 'chamfer on the last corner');
  assert.ok(pts.some(([x, y]) => x === 0 && y === 0), 'size 0 keeps a sharp corner');
});

test('collinear and duplicate points are removed, so extrusions get no zero-area caps', () => {
  const pts = outline(k.shape.rounded([[0, 0], [0.5, 0], [1, 0], [1, 0], [1, 1], [0, 1]]));
  assert.equal(pts.length, 4);
  const g = k.geo.extrude(k.shape.chamfered([[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]], { size: 0.1 }), 0.2, { axis: 'z' });
  for (const t of triangles(g)) assert.ok(triArea(t) > 1e-10);
  assert.throws(() => k.shape.rounded([[0, 0], [1, 0], [2, 0]]), /not on one line/);
});

test('polyline is a band of constant width with chamfered bends', () => {
  const band = outline(k.shape.polyline([[0, 0], [1, 0], [1, 1]], { width: 0.1, size: 0.2 }));
  // Area = width × centerline length (straight runs 0.8 + 0.8, chamfer run 0.2·√2).
  const center = 0.8 + 0.8 + 0.2 * Math.SQRT2;
  assert.ok(Math.abs(area(band) - 0.1 * center) < 0.01, `area ${area(band)}`);
  assert.throws(() => k.shape.polyline([[0, 0], [0, 0]]), /2 distinct points/);
});

test('offset shrinks and grows by the distance, and survives chamfers smaller than the inset', () => {
  const inner = outline(k.shape.offset(k.shape.polygon(square), -0.1));
  assert.ok(Math.abs(area(inner) - 0.64) < 1e-9);
  const outer = outline(k.shape.offset(k.shape.polygon(square), 0.1));
  assert.ok(Math.abs(area(outer) - 1.44) < 1e-9);
  // A 0.02 chamfer inset by 0.05 would turn around: the short edge is dropped instead.
  const plate = outline(k.shape.offset(k.shape.chamfered(square, { size: 0.02 }), -0.05));
  for (let i = 0; i < plate.length; i++) {
    const [ax, ay] = plate[i];
    const [bx, by] = plate[(i + 1) % plate.length];
    assert.ok(Math.hypot(bx - ax, by - ay) > 1e-4, 'no near-duplicate points');
  }
  assert.throws(() => k.shape.offset(k.shape.polygon(square), -0.6), /collapses/);
});

test('spline outlines are closed, smooth and deterministic', () => {
  const a = outline(k.shape.spline([[0, 0], [1, 0], [1.2, 1], [0, 1.1]], { segments: 40 }));
  const b = outline(k.shape.spline([[0, 0], [1, 0], [1.2, 1], [0, 1.1]], { segments: 40 }));
  assert.deepEqual(a, b);
  assert.ok(a.length >= 39);
  assert.ok(a.some(([x, y]) => Math.hypot(x, y) < 1e-9), 'passes through its points');
});

test('loft joins sections into a closed, outward-facing solid', () => {
  const g = k.geo.loft([
    { at: 0, shape: k.shape.rect(0.2, 0.2) },
    { at: 0.5, shape: k.shape.circle(0.08, 24) },
  ], { samples: 32 });
  const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  assert.ok(Math.abs(box.min.x) < 1e-9 && Math.abs(box.max.x - 0.5) < 1e-9, 'runs along X from the first to the last section');
  assert.ok(Math.abs(box.max.y - 0.1) < 1e-6);
  assert.ok(volume(g) > 0, 'faces point outward');
  // Between a 0.2 square (0.04 m²) and a circle (≈0.0201 m²) over 0.5 m.
  assert.ok(volume(g) > 0.01 && volume(g) < 0.02, `volume ${volume(g)}`);
  assert.throws(() => k.geo.loft([{ at: 0, shape: k.shape.rect(0.1, 0.1) }]), /2 sections|two sections|at least/);
});

test('sweep follows an S-curve without flipping and faces outward', () => {
  const path = [[0, 0, 0], [0.3, 0.2, 0], [0.6, -0.2, 0.1], [0.9, 0, 0]];
  const g = k.geo.sweep(k.shape.circle(0.02, 12), path, { segments: 48 });
  assert.ok(volume(g) > 0, 'faces point outward');
  // A tube of radius 0.02: volume ≈ π r² × path length (no twist collapse).
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)));
  const expected = Math.PI * 0.02 * 0.02 * curve.getLength();
  assert.ok(Math.abs(volume(g) - expected) / expected < 0.1, `volume ${volume(g)} vs ${expected}`);
});

test('dualProfile is the intersection of the side and top views', () => {
  const g = k.geo.dualProfile({
    side: k.shape.polygon([[0, 0], [1, 0], [1, 0.3], [0, 0.1]]),
    top: k.shape.polygon([[0, -0.05], [1, -0.1], [1, 0.1], [0, 0.05]]),
  });
  const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  assert.ok(box.min.distanceTo(new THREE.Vector3(0, 0, -0.1)) < 1e-4, `min ${box.min.toArray()}`);
  assert.ok(box.max.distanceTo(new THREE.Vector3(1, 0.3, 0.1)) < 1e-4, `max ${box.max.toArray()}`);
  // At the narrow end the solid is only 0.1 wide and 0.1 tall.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getX(i) < 1e-6) assert.ok(Math.abs(p.getZ(i)) <= 0.05 + 1e-6 && p.getY(i) <= 0.1 + 1e-6);
  }
  assert.ok(volume(g) > 0);
  for (const t of triangles(g)) assert.ok(triArea(t) > 0, 'no degenerate CSG slivers');
});

test('a part that touches nothing and floats above the ground is reported (info)', async () => {
  const { report } = await buildItem({ slug: 'fx-floating', profileId: 'generic', write: false });
  const found = report.issues.filter((i) => i.id === 'scene.floating-part');
  assert.equal(found.length, 1, issueIds(report).join(', '));
  assert.equal(found[0].severity, 'info');
  assert.match(found[0].message, /12 triangles, around 0\.000, 0\.900/, 'the hovering cube, not the crate on the ground');
});
