import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, useFixtures } from './helpers.js';

const assets = fs.mkdtempSync(path.join(ROOT, '.tmp-editor-parts-'));
const state = useFixtures({ assets });
after(() => { fs.rmSync(assets, { recursive: true, force: true }); fs.rmSync(state, { recursive: true, force: true }); });
const slug = 'part-fixture';
const dir = path.join(assets, slug);
fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, 'asset.js'), `import { defineAsset } from '../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'Part fixture', category: 'container' }, params: { width: 0.4 }, variants: { open: { width: 0.6 } }, skins: { red: {} },
  editor: { version: 1, groups: [{ id: 'shape', label: 'Shape' }], controls: [{ key: 'width', label: 'Width', group: 'shape', type: 'number', min: 0.2, max: 1, step: 0.1, unit: 'm' }],
    parts: [{ id: 'lid', label: 'Lid', transform: { move: true, rotate: true, scale: true } }] },
  build({ p, k }) {
    const root = k.asset('fixture');
    const mat = k.mat.pbr({ name: 'wood', color: '#996633' });
    root.add(k.mesh(k.geo.box(p.width, 0.2, 0.4, { base: true }), mat));
    const lid = k.part('lid', { separate: true, pivot: [0, 0.2, -0.2], id: 'lid' });
    lid.add(k.mesh(k.geo.box(p.width, 0.04, 0.4), mat, { at: [0, 0.22, 0] }));
    const latchTex = k.tex.create(16, 16, { name: 'latch_tex', layout: 'atlas' }).fill('#ddbb55');
    lid.add(k.mesh(k.uv.offset(k.uv.box(k.geo.box(0.05, 0.02, 0.05), { scale: 1 }), 0.5, 0.5), k.mat.pbr({ name: 'latch', map: latchTex, metalness: 1 }), { at: [0, 0.25, 0.1] }));
    if (p.width > 0.5) lid.rotation.x = -0.5;
    root.add(lid);
    return root;
  },
});\n`);

const editor = await import('../studio/core/editor.js');
const { buildItem } = await import('../studio/core/build.js');
const { inspectGLB } = await import('../studio/core/inspect.js');
const { loadAssetDef } = await import('../studio/core/load-asset.js');
const { runAsset, assertPartTransform } = await import('../studio/kit/index.js');
const { defineAsset } = await import('../studio/kit/index.js');
const { sceneToIR } = await import('../studio/core/ir/from-three.js');
const { applyProfile } = await import('../studio/core/transforms/index.js');
const { loadProfile } = await import('../studio/profiles/index.js');
const { irToGLB } = await import('../studio/core/ir/to-gltf.js');
const THREE = await import('three');
const { sourceMoveDeltaFromGLB } = await import('../studio/viewport/parts.js');

const record = (move = [0, 0, 0], rotation = [0, 0, 0, 1], scale = 1) => ({ move, rotation, scale });

test('part transforms persist separately from parameters and variant pose', async () => {
  const initial = await editor.editorData(slug);
  assert.equal(initial.parts[0].id, 'lid');
  assert.equal(initial.parts[0].editable, true);
  assert.deepEqual(initial.partTransforms.effective.lid, record());
  const base = await editor.replaceEditorScope({ slug, scope: 'base', partTransforms: { lid: record([0.1, 0, 0], [0, 0, 0, -1], 1.25) }, expectedRevision: initial.revision });
  assert.deepEqual(base.partTransforms.effective.lid.move, [0.1, 0, 0]);
  assert.deepEqual(base.partTransforms.effective.lid.rotation, [0, 0, 0, 1]);
  const editedParams = await editor.replaceEditorScope({ slug, scope: 'base', values: { width: 0.5 }, expectedRevision: base.revision });
  assert.equal(editedParams.partTransforms.effective.lid.scale, 1.25);
  const inherited = await editor.editorData(slug, { variant: 'open' });
  assert.equal(inherited.partTransforms.origins.lid, 'base');
  assert.ok(Math.abs(inherited.parts[0].authored.rotation[0]) > 0.1);
  const variant = await editor.replaceEditorScope({ slug, scope: 'variant', variant: 'open', partTransforms: { lid: record([0, 0.05, 0], [0, 0, 0, 1], 0.8) }, expectedRevision: editedParams.revision });
  assert.deepEqual(variant.partTransforms.effective.lid.move, [0, 0.05, 0]);
  assert.equal(variant.partTransforms.origins.lid, 'variant-edit');
  const resetVariant = await editor.replaceEditorScope({ slug, scope: 'variant', variant: 'open', partTransforms: { lid: record([0.1, 0, 0], [0, 0, 0, 1], 1.25) }, expectedRevision: variant.revision });
  assert.deepEqual(resetVariant.overrides.partTransforms.variants, {});
  const readSkin = await editor.editorData(slug, { skin: 'red' });
  assert.equal(readSkin.editable, false);
  assert.equal(readSkin.partTransforms.effective.lid.scale, 1.25);
});

test('GLB keeps stable part identity across profiles and scale stays baked', async () => {
  for (const profileId of ['generic', 'godot', 'roblox']) {
    const built = await buildItem({ slug, profileId, force: true });
    assert.equal(built.report.counts.error, 0, built.report.issues.map((issue) => `${issue.id}: ${issue.message}`).join('; '));
    const inspected = await inspectGLB(built.glb);
    const part = inspected.nodes.find((node) => node.extras?.studio?.partId === 'lid');
    assert.ok(part, `${profileId} part ID`);
    assert.equal(part.extras.studio.parentPartId, null);
    assert.deepEqual(part.scale, [1, 1, 1]);
    assert.equal(built.report.parts[0].effective.scale[0], 1.25);
    if (profileId === 'roblox') assert.ok(inspected.nodes.some((node) => node.parent === part.index && node.hasMesh), 'Roblox split mesh remains under authored part');
  }
  const def = await loadAssetDef(slug);
  const edits = editor.readEditorOverrides(slug, def);
  const a = runAsset(def, { editor: edits });
  const b = runAsset(def, { skin: 'red', editor: edits });
  assert.deepEqual(a.parts[0].effective.worldMatrix, b.parts[0].effective.worldMatrix);
});

test('invalid transforms fail before sidecar write', async () => {
  const current = await editor.editorData(slug);
  const before = fs.readFileSync(editor.editorFile(slug), 'utf8');
  await assert.rejects(editor.replaceEditorScope({ slug, scope: 'base', partTransforms: { lid: record([3, 0, 0]) }, expectedRevision: current.revision }), /invalid transform/);
  await assert.rejects(editor.replaceEditorScope({ slug, scope: 'base', partTransforms: { missing: record() }, expectedRevision: current.revision }), /not an editable part/);
  assert.equal(fs.readFileSync(editor.editorFile(slug), 'utf8'), before);
  assert.deepEqual(assertPartTransform(record([0, 0, 0], [0, 0, 0, -1]), 'lid').rotation, [0, 0, 0, 1]);
});

test('nested separate parts keep parent identity through merged wrappers and authored pivots', () => {
  const def = defineAsset({ meta: { title: 'Nested part' }, params: {},
    editor: { version: 1, groups: [], controls: [], parts: [
      { id: 'parent', label: 'Parent', transform: { move: true, rotate: true, scale: true } },
      { id: 'child', label: 'Child', transform: { move: true, rotate: true, scale: true } },
    ] },
    build({ k }) {
      const root = k.asset('nested');
      const material = k.mat.pbr({ name: 'mat', color: '#889999' });
      root.add(k.mesh(k.geo.box(0.2, 0.2, 0.2, { base: true }), material));
      const parent = k.part('parent', { id: 'parent', separate: true, pivot: [0, 0.2, 0] });
      const wrapper = k.part('wrapper', { id: 'wrapper' });
      const child = k.part('child', { id: 'child', separate: true, pivot: [0, 0.3, 0] });
      child.add(k.mesh(k.geo.box(0.1, 0.1, 0.1), material, { at: [0, 0.3, 0] }));
      wrapper.add(child);
      parent.add(wrapper);
      root.add(parent);
      return root;
    },
  });
  const editorState = { version: 1, base: {}, variants: {}, partTransforms: { base: {
    parent: record([0.1, 0, 0], [0, Math.SQRT1_2, 0, Math.SQRT1_2], 1.5),
    child: record([0, 0.05, 0]),
  }, variants: {} } };
  const run = runAsset(def, { editor: editorState });
  const child = run.parts.find((part) => part.id === 'child');
  assert.equal(child.parentPartId, 'parent');
  assert.equal(child.editable, true);
  assert.deepEqual(child.pivot, [0, 0.3, 0]);
  const ir = sceneToIR(run.root, { slug: 'nested', meta: def.meta });
  const parentNode = ir.nodes.find((node) => node.extras?.studio?.partId === 'parent');
  const childNode = ir.nodes.find((node) => node.extras?.studio?.partId === 'child');
  assert.ok(parentNode && childNode);
  assert.equal(childNode.parent, ir.nodes.indexOf(parentNode));
  assert.equal(childNode.extras.studio.parentPartId, 'parent');
});

test('duplicate IDs and nonuniform ancestors cannot silently become editable', () => {
  const duplicate = defineAsset({ meta: { title: 'Duplicate part' }, params: {},
    editor: { version: 1, groups: [], controls: [], parts: [{ id: 'same', label: 'Same', transform: { move: true } }] },
    build({ k }) { const root = k.asset('dup'); root.add(k.mesh(k.geo.box(0.1, 0.1, 0.1, { base: true }), k.mat.pbr({ name: 'mat', color: '#888888' })), k.part('a', { id: 'same' }), k.part('b', { id: 'same' })); return root; } });
  assert.throws(() => runAsset(duplicate), /duplicate part id/);
  const unsafe = defineAsset({ meta: { title: 'Unsafe parent' }, params: {},
    editor: { version: 1, groups: [], controls: [], parts: [{ id: 'part', label: 'Part', transform: { move: true, rotate: true, scale: true } }] },
    build({ k }) {
      const root = k.asset('unsafe');
      const wrapper = k.group('wrapper'); wrapper.scale.set(2, 1, 1);
      const part = k.part('part', { id: 'part', separate: true, pivot: [0, 0.2, 0] });
      part.add(k.mesh(k.geo.box(0.1, 0.1, 0.1), k.mat.pbr({ name: 'mat', color: '#888888' }), { at: [0, 0.2, 0] }));
      wrapper.add(part); root.add(wrapper); return root;
    } });
  assert.equal(runAsset(unsafe).parts[0].editable, false);
  assert.match(runAsset(unsafe).parts[0].reason, /Nonuniform/);
});

test('gizmo Move converts through rotated merged wrapper and exported parent frame', () => {
  const sourceParent = new THREE.Matrix4().compose(new THREE.Vector3(2, 3, 4),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), new THREE.Vector3(1.5, 1.5, 1.5));
  const glbParent = new THREE.Matrix4().compose(new THREE.Vector3(10, 0, 0),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4), new THREE.Vector3(1, 1, 1));
  const desiredSourceMove = new THREE.Vector3(0.2, 0, 0);
  const units = 25 / 7;
  const worldGlbDelta = desiredSourceMove.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(sourceParent)).multiplyScalar(units);
  const localGlbDelta = worldGlbDelta.applyMatrix3(new THREE.Matrix3().setFromMatrix4(glbParent).invert());
  const result = sourceMoveDeltaFromGLB(localGlbDelta, glbParent, sourceParent, units);
  assert.ok(result.distanceTo(desiredSourceMove) < 1e-9);
});

test('Roblox triangle chunks stay beneath one authored part ID', async () => {
  const def = defineAsset({ meta: { title: 'Chunk fixture' }, params: {},
    editor: { version: 1, groups: [], controls: [], parts: [{ id: 'heavy', label: 'Heavy', transform: { move: true } }] },
    build({ k, THREE }) {
      const root = k.asset('chunks');
      const part = k.part('heavy', { id: 'heavy', separate: true, pivot: [0, 0, 0] });
      const triangleCount = 20_010;
      const positions = new Float32Array(triangleCount * 9);
      const normals = new Float32Array(triangleCount * 9);
      const uvs = new Float32Array(triangleCount * 6);
      for (let t = 0; t < triangleCount; t++) {
        const x = (t % 200) * 0.004;
        const y = Math.floor(t / 200) * 0.004;
        positions.set([x, y, 0, x + 0.001, y, 0, x, y + 0.001, 0], t * 9);
        normals.set([0, 0, 1, 0, 0, 1, 0, 0, 1], t * 9);
        uvs.set([0, 0, 0.5, 0, 0, 0.5], t * 6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      part.add(k.mesh(geo, k.mat.pbr({ name: 'flat', color: '#888888' })));
      root.add(part);
      return root;
    },
  });
  const run = runAsset(def);
  const ir = sceneToIR(run.root, { slug: 'chunks', meta: def.meta });
  await applyProfile(ir, loadProfile('roblox'));
  const authored = ir.nodes.findIndex((node) => node.extras?.studio?.partId === 'heavy');
  const chunks = ir.nodes.filter((node) => node.parent === authored && /_chunk\d+$/.test(node.name));
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((node) => !node.extras?.studio?.partId));
  const { glb } = await irToGLB(ir, { profileId: 'roblox' });
  const inspected = await inspectGLB(glb);
  const partNode = inspected.nodes.find((node) => node.extras?.studio?.partId === 'heavy');
  assert.ok(partNode);
  assert.equal(inspected.nodes.filter((node) => node.extras?.studio?.partId === 'heavy').length, 1);
  assert.ok(inspected.nodes.filter((node) => node.parent === partNode.index && node.hasMesh).length >= 2);
});
