import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useFixtures, errors } from './helpers.js';

useFixtures();
const { buildItem } = await import('../studio/core/build.js');
const { resolveTargets } = await import('../studio/core/targets.js');
const { exportItem } = await import('../studio/core/export.js');
const { writeSkinPack, skinPackDir, variantsGlbPath, skinSwitcherLua } = await import('../studio/core/skins.js');
const { defineAsset } = await import('../studio/kit/index.js');
const { decodePNG } = await import('../studio/core/inspect.js');
const { NodeIO } = await import('@gltf-transform/core');
const { KHRMaterialsVariants, KHRMaterialsEmissiveStrength } = await import('@gltf-transform/extensions');

test('skins are declared like variants and addressed as slug@skin', async () => {
  assert.throws(() => defineAsset({ meta: { title: 'x' }, skins: { default: {} }, build: () => null }), /reserved/);
  assert.throws(() => defineAsset({ meta: { title: 'x' }, skins: { red: { seed: 2 } }, build: () => null }), /cannot change the seed/);
  assert.deepEqual(await resolveTargets(['fx-skins@paint']), [{ slug: 'fx-skins', variant: null, skin: 'paint' }]);
  assert.deepEqual((await resolveTargets(['fx-skins'])).map((i) => i.skin), [null], 'skins are left out unless asked for');
  assert.deepEqual((await resolveTargets(['fx-skins'], { skin: 'all' })).map((i) => i.skin), [null, 'paint', 'bad-shape', 'bad-material']);
  await assert.rejects(resolveTargets(['fx-skins'], { skin: 'nope' }), /unknown skin 'nope'/);
});

test('a texture-only skin keeps the exact mesh and UVs in every profile (Roblox palette included)', async () => {
  for (const profileId of ['generic', 'godot', 'roblox']) {
    const base = (await buildItem({ slug: 'fx-skins', profileId })).report;
    const paint = (await buildItem({ slug: 'fx-skins', skin: 'paint', profileId })).report;
    assert.deepEqual(errors(paint), [], `${profileId}: ${errors(paint).join(', ')}`);
    assert.equal(paint.skin, 'paint');
    assert.equal(paint.id, 'fx-skins@paint');
    assert.equal(paint.geometry.hash, base.geometry.hash, `${profileId}: same nodes, triangles, normals and UVs`);
    assert.deepEqual(paint.materials.map((m) => m.name), base.materials.map((m) => m.name));
    // Roblox bakes colors into the palette texture; elsewhere they stay material factors.
    const colors = (r) => (profileId === 'roblox' ? r.palette[0].swatches.map((s) => s.color.join(',')) : r.materials.map((m) => m.baseColor));
    assert.notDeepEqual(colors(paint), colors(base), 'the colors did change');
  }
  // Assets with skins keep materials that look the same apart (trim and cap match in the base look).
  const generic = (await buildItem({ slug: 'fx-skins', profileId: 'generic' })).report;
  assert.deepEqual(generic.materials.map((m) => m.name), ['body', 'trim', 'cap', 'panel']);
  // ...and the Roblox palette gets one swatch per flat material, so UVs never depend on colors.
  const roblox = (await buildItem({ slug: 'fx-skins', profileId: 'roblox' })).report;
  assert.equal(roblox.palette[0].swatches.length, 3);
  assert.deepEqual(roblox.palette[0].swatches.map((s) => s.materials), [['body'], ['trim'], ['cap']]);
});

test('the skin lock blocks skins that change the shape or the material slots', async () => {
  const shape = (await buildItem({ slug: 'fx-skins', skin: 'bad-shape', profileId: 'generic' })).report;
  assert.ok(errors(shape).includes('skin.geometry-changed'), errors(shape).join(', '));
  assert.match(shape.issues.find((i) => i.id === 'skin.geometry-changed').message, /body \(positions/);
  const mat = (await buildItem({ slug: 'fx-skins', skin: 'bad-material', profileId: 'generic' })).report;
  assert.ok(errors(mat).includes('skin.materials-changed'), errors(mat).join(', '));
  assert.match(mat.issues.find((i) => i.id === 'skin.materials-changed').message, /cap\[OPAQUE:\] → cap\[OPAQUE:baseColor\]/);
  const r = await exportItem({ slug: 'fx-skins', skin: 'bad-shape', profileId: 'generic', parity: false });
  assert.equal(r.blocked, true);
});

test('skin packs: maps per look, Roblox SurfaceAppearance maps + switcher, one KHR_materials_variants GLB', async () => {
  for (const profileId of ['generic', 'roblox']) {
    for (const skin of [null, 'paint']) {
      const r = await exportItem({ slug: 'fx-skins', skin, profileId, parity: false });
      assert.equal(r.blocked, false, `${profileId}/${skin}: ${r.reason}`);
    }
  }
  const roblox = await writeSkinPack({ slug: 'fx-skins', profileId: 'roblox', title: 'Skins Test', skins: ['paint'] });
  const rdir = skinPackDir('fx-skins', null, 'roblox');
  const manifest = JSON.parse(fs.readFileSync(path.join(rdir, 'skins.json'), 'utf8'));
  assert.deepEqual(manifest.looks, ['default', 'paint']);
  assert.deepEqual(roblox.looks, ['default', 'paint']);
  assert.ok(fs.existsSync(path.join(rdir, 'SkinSwitcher.lua')));
  assert.equal(fs.readFileSync(path.join(rdir, 'SkinSwitcher.lua'), 'utf8'), skinSwitcherLua());
  const sa = manifest.surfaceAppearances.paint;
  assert.deepEqual(Object.keys(sa).sort(), manifest.meshes.map((m) => m.node).sort(), 'one SurfaceAppearance per MeshPart');
  const palette = sa.body_palette;
  assert.ok(palette.ColorMap && palette.MetalnessMap && palette.RoughnessMap, JSON.stringify(palette));
  // Metalness/roughness are the B/G channels of the glTF metallicRoughness map, as grayscale.
  const glb = new Uint8Array(fs.readFileSync(path.join(process.env.STUDIO_EXPORTS_DIR, 'roblox', 'fx-skins@paint.glb')));
  const pdoc = await new NodeIO().registerExtensions([KHRMaterialsVariants, KHRMaterialsEmissiveStrength]).readBinary(glb);
  const mrTex = pdoc.getRoot().listMaterials().find((m) => m.getName() === 'palette').getMetallicRoughnessTexture();
  const mr = decodePNG(mrTex.getImage());
  const metal = decodePNG(new Uint8Array(fs.readFileSync(path.join(rdir, palette.MetalnessMap))));
  const rough = decodePNG(new Uint8Array(fs.readFileSync(path.join(rdir, palette.RoughnessMap))));
  for (let i = 0; i < mr.data.length; i += 4 * 7) {
    assert.equal(metal.data[i], mr.data[i + 2]);
    assert.equal(rough.data[i], mr.data[i + 1]);
  }
  // Generic: every look in one GLB that passes the Khronos validator.
  const generic = await writeSkinPack({ slug: 'fx-skins', profileId: 'generic', title: 'Skins Test', skins: ['paint'] });
  assert.equal(generic.manifest.variantsGlb.khronos.errors, 0);
  const io = new NodeIO().registerExtensions([KHRMaterialsVariants, KHRMaterialsEmissiveStrength]);
  const doc = await io.readBinary(new Uint8Array(fs.readFileSync(variantsGlbPath('fx-skins', null))));
  const ext = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'KHR_materials_variants');
  assert.ok(ext, 'KHR_materials_variants is used');
  const variants = ext.listVariants().map((v) => v.getName());
  assert.deepEqual(variants, ['default', 'paint']);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const list = prim.getExtension('KHR_materials_variants');
      assert.ok(list, 'every primitive has a variant mapping');
      assert.equal(list.listMappings().length, 2);
    }
  }
});
