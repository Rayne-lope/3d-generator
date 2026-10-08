// Verify the HTTP boundary, not only the pure transform resolver.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';

const assets = fs.mkdtempSync(path.join(ROOT, '.tmp-part-api-'));
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'part-api-state-'));
Object.assign(process.env, { STUDIO_ASSETS_DIR: assets, STUDIO_SETS_DIR: path.join(state, 'sets'), STUDIO_STATE_DIR: state, STUDIO_EXPORTS_DIR: path.join(state, 'exports'), STUDIO_NO_NOTIFY: '1' });
after(() => { for (const dir of [assets, state]) fs.rmSync(dir, { recursive: true, force: true }); });
const slug = 'part-api-fixture';
fs.mkdirSync(path.join(assets, slug));
fs.writeFileSync(path.join(assets, slug, 'asset.js'), `
import { defineAsset } from '../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'Part API fixture', category: 'container' }, params: {},
  editor: { version: 1, groups: [], controls: [], parts: [{ id: 'lid', label: 'Lid', transform: { move: true, rotate: true, scale: true } }] },
  variants: { open: {} }, skins: { red: {} },
  build({ k }) {
    const root = k.asset('part_api'); const mat = k.mat.pbr({ name: 'wood', color: '#996633' });
    root.add(k.mesh(k.geo.box(0.4, 0.2, 0.4, { base: true }), mat));
    const lid = k.part('lid', { id: 'lid', separate: true, pivot: [0, 0.2, -0.2] });
    lid.add(k.mesh(k.geo.box(0.4, 0.04, 0.4), mat, { at: [0, 0.22, 0] })); root.add(lid); return root;
  },
});`);
const { startServer } = await import('../studio/server/server.js');
const { historyDir } = await import('../studio/core/history.js');

test('transform-only editor API validates before write and checkpoints/restores variants', { timeout: 120_000 }, async () => {
  const server = await startServer({ port: 0 });
  const url = server.info.url;
  const get = async (suffix = '') => (await (await fetch(`${url}api/editor?slug=${slug}${suffix}`)).json());
  const put = body => fetch(`${url}api/editor`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const post = (endpoint, body) => fetch(`${url}api/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const sidecar = path.join(assets, slug, 'editor.json');
  try {
    const initial = await get();
    assert.equal(initial.eligible, true);
    assert.equal(initial.editable, true);
    const delta = { move: [0.05, 0.03, 0], rotation: [0, 0, 0, 1], scale: 1.2 };
    const first = await put({ slug, scope: 'base', partTransforms: { lid: delta }, expectedRevision: initial.revision });
    assert.equal(first.status, 200);
    const saved = await first.json();
    const bytes = fs.readFileSync(sidecar, 'utf8');
    const invalidProfile = await put({ slug, scope: 'base', profile: 'unknown-profile', partTransforms: { lid: { ...delta, scale: 1.25 } }, expectedRevision: saved.revision });
    assert.equal(invalidProfile.status, 400);
    assert.equal(fs.readFileSync(sidecar, 'utf8'), bytes, 'invalid look/profile must not write a valid transform first');
    for (const partTransforms of [
      { unknown: delta }, { lid: { ...delta, scale: 0 } }, { lid: { ...delta, scale: -1 } },
      { lid: { ...delta, move: [Infinity, 0, 0] } }, { lid: { ...delta, rotation: [0, 0, 0, 0] } },
    ]) {
      const invalid = await put({ slug, scope: 'base', partTransforms, expectedRevision: saved.revision });
      assert.equal(invalid.status, 400);
      assert.equal(fs.readFileSync(sidecar, 'utf8'), bytes);
    }
    const skin = await put({ slug, scope: 'base', skin: 'red', partTransforms: {}, expectedRevision: saved.revision });
    assert.equal(skin.status, 400);
    const stale = await put({ slug, scope: 'base', partTransforms: {}, expectedRevision: initial.revision });
    assert.equal(stale.status, 409);
    const noNote = await post('history/save', { slug, note: '', expectedRevision: saved.revision });
    assert.equal(noNote.status, 400);
    const checkpoint = await post('history/save', { slug, variant: 'open', note: 'Part checkpoint', expectedRevision: saved.revision });
    assert.equal(checkpoint.status, 200);
    const response = await checkpoint.json();
    assert.equal(response.result.skipped, false);
    const version = response.result.version.id;
    assert.ok(fs.existsSync(path.join(historyDir(slug), version, 'generic--open.glb')));
    const next = await put({ slug, scope: 'base', partTransforms: { lid: { ...delta, scale: 1.3 } }, expectedRevision: saved.revision });
    assert.equal(next.status, 200);
    const revision = (await next.json()).revision;
    const restore = await post('history/restore', { slug, version, expectedRevision: revision });
    assert.equal(restore.status, 200);
    assert.equal((await get()).partTransforms.effective.lid.scale, 1.2);
    const reset = await put({ slug, scope: 'base', partTransforms: {}, expectedRevision: (await get()).revision });
    assert.equal(reset.status, 200);
    assert.equal(fs.existsSync(sidecar), false);
  } finally { server.close(); }
});
