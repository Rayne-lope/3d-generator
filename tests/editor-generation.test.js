// New assets inherit editor support from scaffolds. Use disposable sources/state only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';

const assets = fs.mkdtempSync(path.join(ROOT, '.tmp-editor-generation-'));
const sets = fs.mkdtempSync(path.join(ROOT, '.tmp-editor-generation-sets-'));
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-generation-state-'));
Object.assign(process.env, {
  STUDIO_ASSETS_DIR: assets, STUDIO_SETS_DIR: sets, STUDIO_STATE_DIR: state,
  STUDIO_EXPORTS_DIR: path.join(state, 'exports'), STUDIO_NO_NOTIFY: '1',
});
after(() => {
  for (const dir of [assets, sets, state]) fs.rmSync(dir, { recursive: true, force: true });
});

const { scaffoldAsset } = await import('../studio/cli/new.js');
const { run: scaffoldSet } = await import('../studio/cli/new-set.js');
const { loadAssetDef } = await import('../studio/core/load-asset.js');
const { buildItem } = await import('../studio/core/build.js');
const { editorData, replaceEditorScope } = await import('../studio/core/editor.js');
const { exportItem } = await import('../studio/core/export.js');
const profiles = ['generic', 'godot', 'roblox'];
const clean = (r, label) => assert.equal(r.counts.error, 0, `${label}: ${r.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ')}`);

test('standalone scaffold is editable without an editor request in the prompt', async () => {
  const slug = 'new-crate';
  scaffoldAsset({ slug, prompt: 'A small wooden crate' });
  const data = await editorData(slug);
  assert.equal(data.eligible, true);
  assert.equal(data.editable, true);
  assert.ok(data.controls.some(c => c.key === 'width'));
  assert.ok(data.controls.some(c => c.key === 'color'));
  assert.equal(data.controls.some(c => /seed|texture/i.test(c.key)), false);
  const next = await replaceEditorScope({ slug, scope: 'base', values: { width: 0.95, color: '#19384f' }, expectedRevision: data.revision });
  assert.equal(next.effective.width, 0.95);
  const def = await loadAssetDef(slug);
  assert.equal(def.meta.prompt, 'A small wooden crate');
  for (const profileId of profiles) clean((await buildItem({ slug, profileId })).report, `${slug}/${profileId}`);
});

test('set-member scaffold keeps shared style while supplying curated shape controls', async () => {
  await scaffoldSet(['new-pack', '--members', 'box', '--prompt', 'Matching wooden boxes', '--json']);
  const slug = 'new-pack-box';
  const file = path.join(assets, slug, 'asset.js');
  // Keep the template's real ../../sets import intact in production; redirect only this fixture.
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('../../sets/', `../../${path.basename(sets)}/`));
  const data = await editorData(slug);
  assert.equal(data.editable, true);
  assert.deepEqual(data.controls.map(c => c.key), ['width', 'height', 'depth']);
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /style\.materials\(k\)/);
  for (const profileId of profiles) clean((await buildItem({ slug, profileId })).report, `${slug}/${profileId}`);
});

test('new authored separate part exposes transforms and keeps skin lock and strict exports', async () => {
  const slug = 'new-hinged-box';
  fs.mkdirSync(path.join(assets, slug));
  fs.writeFileSync(path.join(assets, slug, 'asset.js'), `
import { defineAsset } from '../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'New hinged box', category: 'container', budget: { triangles: 5000 } },
  params: { opening: 0, color: '#31568b' },
  editor: {
    version: 1, groups: [{ id: 'shape', label: 'Shape' }, { id: 'surface', label: 'Surface' }],
    controls: [
      { key: 'opening', type: 'number', label: 'Opening', group: 'shape', min: 0, max: 1.2, step: 0.1, unit: 'rad', partIds: ['panel'] },
      { key: 'color', type: 'color', label: 'Paint', group: 'surface' },
    ],
    parts: [{ id: 'panel', label: 'Panel', transform: { move: true, rotate: true, scale: true } }],
  },
  variants: { open: { opening: 1 } }, skins: { red: { color: '#bb3434' } },
  build({ p, k }) {
    const root = k.asset('hinged_box');
    const body = k.part('body', { id: 'body' });
    const panel = k.part('panel', { id: 'panel', separate: true, pivot: [0, 0.2, -0.25] });
    const mat = k.mat.physical('painted-wood', { color: p.color });
    body.add(k.mesh(k.geo.box(1, 0.2, 0.5, { base: true }), mat));
    panel.add(k.mesh(k.geo.box(1, 0.04, 0.5, { base: true }), mat, { at: [0, 0.2, 0] }));
    panel.rotation.x = -p.opening;
    root.add(body, panel); return root;
  },
});`);
  const first = await editorData(slug, { variant: 'open' });
  assert.equal(first.parts.find(p => p.id === 'panel')?.editable, true);
  const delta = { move: [0.01, 0.03, 0], rotation: [0, Math.sin(Math.PI / 36), 0, Math.cos(Math.PI / 36)], scale: 1.1 };
  const next = await replaceEditorScope({ slug, scope: 'variant', variant: 'open', partTransforms: { panel: delta }, expectedRevision: first.revision });
  assert.equal(next.partTransforms.effective.panel.scale, 1.1);
  for (const profileId of profiles) {
    const built = await buildItem({ slug, variant: 'open', profileId });
    clean(built.report, `${slug}/${profileId}`);
    assert.ok(built.report.nodes.some(n => n.partId === 'panel'));
    const skin = await buildItem({ slug, variant: 'open', skin: 'red', profileId });
    clean(skin.report, `${slug}@red/${profileId}`);
    assert.equal(skin.report.geometry.hash, built.report.geometry.hash);
    const exported = await exportItem({ slug, variant: 'open', profileId });
    assert.equal(exported.blocked, false);
    assert.equal(exported.report.export.previewMatch, true);
  }
});
