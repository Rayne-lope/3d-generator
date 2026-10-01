import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useFixtures, errors, issueIds } from './helpers.js';

useFixtures();
const { buildItem } = await import('../studio/core/build.js');

const build = (slug, profileId, extra = {}) => buildItem({ slug, profileId, write: false, ...extra });
const toSRGB8 = (c) => Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);

test('the kit test asset exports cleanly in every profile', async () => {
  for (const profileId of ['generic', 'godot', 'roblox']) {
    const { report } = await build('kit-test', profileId);
    assert.equal(report.khronos.errors, 0, `${profileId}: glTF validator errors`);
    assert.deepEqual(errors(report), [], `${profileId}: ${errors(report)}`);
  }
});

test('builds are deterministic (same bytes twice)', async () => {
  const a = await build('kit-test', 'roblox');
  const b = await build('kit-test', 'roblox');
  assert.equal(a.report.hashes.glb, b.report.hashes.glb);
});

test('roblox: pre-scaled to studs (25:7)', async () => {
  const g = await build('kit-test', 'generic');
  const r = await build('kit-test', 'roblox');
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(r.report.dimensions.units[i] - g.report.dimensions.units[i] * (25 / 7)) < 1e-3);
  assert.deepEqual(r.report.dimensions.meters, g.report.dimensions.meters);
});

test('roblox: flat colors become one palette material whose swatches match the authored colors', async () => {
  const { report, ir } = await build('kit-test', 'roblox');
  const pal = report.palette[0];
  assert.ok(pal, 'palette material exists');
  for (const src of ir.sourceMaterials.filter((m) => m.baseColorTexture === null)) {
    const sw = pal.swatches.find((s) => s.materials.includes(src.name));
    assert.ok(sw, `swatch for ${src.name}`);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(sw.color[c] - toSRGB8(src.baseColor[c])) <= 1, `${src.name} channel ${c}`);
    assert.ok(Math.abs(sw.roughness - src.roughness) <= 1 / 255 + 1e-6);
    assert.ok(Math.abs(sw.metallic - src.metallic) <= 1 / 255 + 1e-6);
  }
});

test('roblox: one material per mesh, generic keeps material factors without textures', async () => {
  const { info } = await build('kit-test', 'roblox');
  for (const m of info.meshes) assert.equal(new Set(m.primitives.map((p) => p.material)).size, 1);
  const g = await build('kit-test', 'generic');
  assert.equal(g.report.textures.length, 0);
});

test('roblox: big repeating textures are tile-baked into 0..1 UVs at ≤ 1024 px power of two', async () => {
  const { report, info } = await build('fx-bigtex', 'roblox');
  assert.ok(!issueIds(report).includes('uv.out-of-range'));
  for (const t of report.textures) {
    assert.ok(t.width <= 1024 && t.height <= 1024, `${t.name} ${t.width}x${t.height}`);
    assert.equal(t.width & (t.width - 1), 0);
    assert.equal(t.height & (t.height - 1), 0);
  }
  for (const m of info.meshes) for (const p of m.primitives) for (const v of p.uvs) assert.ok(v >= -1e-4 && v <= 1 + 1e-4);
  const g = await build('fx-bigtex', 'generic');
  assert.ok(issueIds(g.report).includes('texture.large'));
  assert.ok(issueIds(g.report).includes('texture.non-power-of-two'));
});

test('roblox: meshes over 20k triangles are split by connected pieces', async () => {
  const { report } = await build('fx-split', 'roblox');
  assert.deepEqual(errors(report), []);
  assert.ok(report.triangles.perMesh.length >= 2);
  for (const m of report.triangles.perMesh) assert.ok(m.triangles <= 20000);
});

test('roblox: a single 30k piece is rejected unless decimation is allowed', async () => {
  const blocked = await build('fx-dense', 'roblox');
  assert.ok(errors(blocked.report).includes('scene.mesh-triangles'));
  const generic = await build('fx-dense', 'generic');
  assert.ok(!errors(generic.report).includes('scene.mesh-triangles'));
  const dec = await build('fx-dense', 'roblox', { allowDecimate: true });
  assert.ok(!errors(dec.report).includes('scene.mesh-triangles'), errors(dec.report).join());
  for (const m of dec.report.triangles.perMesh) assert.ok(m.triangles <= 20000);
});

test('negative scale is baked with fixed winding and reported', async () => {
  const { report } = await build('fx-negscale', 'generic');
  assert.ok(issueIds(report).includes('scene.negative-scale'));
  assert.ok(!issueIds(report).includes('geometry.inverted-faces'));
  assert.ok(!issueIds(report).includes('geometry.inside-out'));
});

test('instanced meshes are flattened into geometry', async () => {
  const { report } = await build('fx-instanced', 'generic');
  assert.ok(issueIds(report).includes('scene.instances-flattened'));
  assert.equal(report.triangles.total, 3 * 12);
});
