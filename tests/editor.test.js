import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, useFixtures } from './helpers.js';

const assets = fs.mkdtempSync(path.join(ROOT, '.tmp-editor-assets-'));
const state = useFixtures({ assets });
after(() => { fs.rmSync(assets, { recursive: true, force: true }); fs.rmSync(state, { recursive: true, force: true }); });
const slug = 'editor-fixture';
const assetDir = path.join(assets, slug);
fs.mkdirSync(assetDir, { recursive: true });
fs.writeFileSync(path.join(assetDir, 'asset.js'), `import { defineAsset } from '../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'Editor Fixture', category: 'prop' },
  params: { size: 0.4, color: '#334455', roughness: 0.6 },
  variants: { wide: { size: 0.8 } },
  skins: { red: { color: '#aa3344' } },
  editor: { version: 1, groups: [{ id: 'shape', label: 'Shape' }, { id: 'surface', label: 'Surface' }], controls: [
    { key: 'size', label: 'Size', group: 'shape', type: 'number', min: 0.1, max: 1, step: 0.01, unit: 'm', displayUnit: 'cm' },
    { key: 'color', label: 'Color', group: 'surface', type: 'color' },
    { key: 'roughness', label: 'Roughness', group: 'surface', type: 'number', min: 0, max: 1, step: 0.01 },
  ] },
  build({ p, k }) {
    const root = k.asset('fixture');
    root.add(k.mesh(k.geo.box(p.size, p.size, p.size, { base: true }), k.mat.pbr({ name: 'body', color: p.color, roughness: p.roughness })));
    return root;
  },
});\n`);
fs.mkdirSync(path.join(assets, 'nonpilot'), { recursive: true });
fs.writeFileSync(path.join(assets, 'nonpilot', 'asset.js'), `import { defineAsset } from '../../studio/kit/index.js';
export default defineAsset({ meta: { title: 'Nonpilot' }, params: { size: 0.2 }, build({ p, k }) { const root = k.asset('nonpilot'); root.add(k.mesh(k.geo.box(p.size,p.size,p.size,{base:true}), k.mat.pbr({name:'body',color:'#888888'}))); return root; } });\n`);

const editor = await import('../studio/core/editor.js');
const { buildItem } = await import('../studio/core/build.js');
const { exportItem } = await import('../studio/core/export.js');
const history = await import('../studio/core/history.js');
const { startServer } = await import('../studio/server/server.js');
const { defineAsset, runAsset, validateEditorState } = await import('../studio/kit/index.js');
const { previewGlb, previewReport } = await import('../studio/core/paths.js');
const validator = (await import('gltf-validator')).default;

test('scoped overrides persist, inherit, reset and preserve strict export', async () => {
  const initial = await editor.editorData(slug);
  assert.equal(initial.effective.size, 0.4);
  const changed = await editor.replaceEditorScope({ slug, scope: 'base', values: { size: 0.6, color: '#112233' }, expectedRevision: initial.revision });
  assert.equal(changed.effective.size, 0.6);
  assert.equal((await editor.editorData(slug, { variant: 'wide' })).effective.size, 0.8);
  const variant = await editor.replaceEditorScope({ slug, scope: 'variant', variant: 'wide', values: { size: 0.9 }, expectedRevision: changed.revision });
  assert.equal(variant.baseline.size, 0.8);
  assert.equal(variant.effective.size, 0.9);
  assert.equal(variant.origins.size, 'variant-edit');
  assert.equal((await editor.editorData(slug, { variant: 'wide', skin: 'red' })).effective.color, '#aa3344');
  await assert.rejects(editor.replaceEditorScope({ slug, scope: 'base', values: {}, expectedRevision: changed.revision }), /source changed/);
  await assert.rejects(editor.replaceEditorScope({ slug, scope: 'variant', variant: 'wide', values: { size: 3 }, expectedRevision: variant.revision }), /invalid value/);
  await assert.rejects(editor.replaceEditorScope({ slug, scope: 'variant', variant: 'wide', values: { size: 0.905 }, expectedRevision: variant.revision }), /invalid step/);
  const build = await buildItem({ slug, variant: 'wide', profileId: 'generic' });
  assert.equal(build.report.counts.error, 0);
  const result = await exportItem({ slug, variant: 'wide', profileId: 'generic', parity: false });
  assert.equal(result.blocked, false);
  assert.equal(result.report.export.previewMatch, true);
  const saved = await history.saveVersion(slug, { note: 'variant edited', build: async (s, v) => (await buildItem({ slug: s, variant: v, profileId: 'generic' })).report, includeVariants: true, preferredVariant: 'wide' });
  assert.ok(saved.version.lookGlbs.wide);
  assert.ok(fs.existsSync(path.join(history.historyDir(slug), saved.version.id, 'generic--wide.report.json')));
  const reset = await editor.replaceEditorScope({ slug, scope: 'variant', variant: 'wide', values: {}, expectedRevision: variant.revision });
  assert.equal(reset.effective.size, 0.8);
  await history.revertVersion(slug, saved.version.id, { build: async (s) => (await buildItem({ slug: s, profileId: 'generic' })).report });
  assert.equal((await editor.editorData(slug, { variant: 'wide' })).effective.size, 0.9);
});

test('local editor API rejects stale writes and invalid values', async () => {
  const server = await startServer({ port: 0 });
  const base = server.info.url;
  try {
    const first = await (await fetch(`${base}api/editor?slug=${slug}&variant=wide`)).json();
    assert.equal(first.effective.size, 0.9);
    const put = (body, headers = {}) => fetch(`${base}api/editor`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const rejected = await put({ slug, scope: 'base', values: { size: 0.7 }, expectedRevision: 'old' });
    assert.equal(rejected.status, 409);
    assert.ok((await rejected.json()).current);
    const invalid = await put({ slug, scope: 'base', values: { size: 4 }, expectedRevision: first.revision });
    assert.equal(invalid.status, 400);
    const valid = await put({ slug, scope: 'base', values: { size: 0.7 }, expectedRevision: first.revision });
    assert.equal(valid.status, 200);
    const updated = await valid.json();
    assert.equal(updated.overrides.base.size, 0.7);
    const cross = await put({ slug, scope: 'base', values: {}, expectedRevision: first.revision }, { origin: 'https://example.com' });
    assert.equal(cross.status, 403);
    const skinWrite = await put({ slug, scope: 'base', skin: 'red', values: {}, expectedRevision: updated.revision });
    assert.equal(skinWrite.status, 400);
    const oversized = await put({ slug, scope: 'base', values: {}, expectedRevision: updated.revision, padding: 'x'.repeat(70000) });
    assert.equal(oversized.status, 413);
    const post = (route, body) => fetch(`${base}api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('build', { slug, variant: 'missing', profile: 'generic' })).status, 404);
    assert.equal((await post('build', { slug, skin: 'missing', profile: 'generic' })).status, 404);
    assert.equal((await post('build', { slug, variant: 0, profile: 'generic' })).status, 400);
    assert.equal((await post('history/save', { slug, note: 'should reject', skin: 'red', expectedRevision: updated.revision })).status, 400);
    assert.equal((await post('history/restore', { slug, version: 'v001', skin: 'red', expectedRevision: updated.revision })).status, 400);
    const built = await post('build', { slug, variant: 'wide', profile: 'generic' });
    assert.equal(built.status, 200);
    const builtJson = await built.json();
    assert.equal(builtJson.ok, true);
    assert.equal(builtJson.revision, updated.revision);
    const fresh = await (await fetch(`${base}api/editor?slug=${slug}&variant=wide&profile=generic`)).json();
    assert.equal(fresh.preview.current, true);
    const save = await post('history/save', { slug, variant: 'wide', note: 'API editor version', expectedRevision: updated.revision });
    assert.equal(save.status, 200);
    const savedVersion = (await save.json()).result.version.id;
    assert.ok(savedVersion);
    const listed = await (await fetch(`${base}api/history?slug=${slug}&variant=wide`)).json();
    assert.ok(listed.versions.at(-1).glb.endsWith('generic--wide.glb'));
    assert.ok(listed.versions.at(-1).report.endsWith('generic--wide.report.json'));
    const exported = await post('export', { slug, variant: 'wide', profile: 'generic', expectedRevision: updated.revision });
    assert.equal(exported.status, 200);
    const exportedJson = await exported.json();
    assert.equal(exportedJson.result.blocked, false);
    assert.ok(exportedJson.result.files.glb.endsWith('.glb'));
    const next = await put({ slug, scope: 'variant', variant: 'wide', values: { size: 1 }, expectedRevision: updated.revision });
    assert.equal(next.status, 200);
    const restore = await post('history/restore', { slug, version: savedVersion, expectedRevision: (await next.json()).revision });
    assert.equal(restore.status, 200);
    assert.equal((await fetch(`${base}api/editor?slug=${slug}&variant=wide`).then((r) => r.json())).effective.size, 0.9);
  } finally { server.close(); }
});

test('nonpilot writes and malformed editor source fail clearly', async () => {
  const server = await startServer({ port: 0 });
  try {
    const base = server.info.url;
    const nonpilot = await (await fetch(`${base}api/editor?slug=nonpilot`)).json();
    assert.equal(nonpilot.eligible, false);
    const put = await fetch(`${base}api/editor`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'nonpilot', scope: 'base', values: {}, expectedRevision: nonpilot.revision }) });
    assert.equal(put.status, 403);
    const save = await fetch(`${base}api/history/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'nonpilot', note: 'test', expectedRevision: nonpilot.revision }) });
    assert.equal(save.status, 403);
    fs.writeFileSync(editor.editorFile(slug), '{broken json');
    const malformed = await fetch(`${base}api/editor?slug=${slug}`);
    assert.equal(malformed.status, 400);
    assert.match((await malformed.json()).error, /invalid editor\.json/);
    fs.writeFileSync(editor.editorFile(slug), JSON.stringify({ version: 1, base: { size: 'large' }, variants: {} }));
    const wrongType = await fetch(`${base}api/editor?slug=${slug}`);
    assert.equal(wrongType.status, 400);
    assert.match((await wrongType.json()).error, /invalid value/);
  } finally {
    fs.rmSync(editor.editorFile(slug), { force: true });
    server.close();
  }
});

test('boolean/select controls validate and scoped merge keeps skin and explicit priority', () => {
  let seen;
  const def = defineAsset({
    meta: { title: 'Schema fixture' },
    params: { size: 0.2, enabled: true, finish: 'paint', color: '#aabbcc' },
    variants: { large: { size: 0.3, enabled: false } },
    skins: { red: { color: '#aa2233' } },
    editor: { version: 1, groups: [{ id: 'shape', label: 'Shape' }], controls: [
      { key: 'size', label: 'Size', group: 'shape', type: 'number', min: 0.1, max: 1, step: 0.01 },
      { key: 'enabled', label: 'Enabled', group: 'shape', type: 'boolean' },
      { key: 'finish', label: 'Finish', group: 'shape', type: 'select', options: [{ value: 'paint', label: 'Paint' }, { value: 'metal', label: 'Metal' }] },
      { key: 'color', label: 'Color', group: 'shape', type: 'color' },
    ] },
    build({ p, k }) { seen = p; const root = k.asset('schema'); root.add(k.mesh(k.geo.box(p.size, p.size, p.size, { base: true }), k.mat.pbr({ name: 'body', color: p.color }))); return root; },
  });
  const edits = { version: 1, base: { size: 0.4, enabled: false, finish: 'metal' }, variants: { large: { size: 0.5, color: '#112233' } } };
  runAsset(def, { variant: 'large', skin: 'red', editor: edits, params: { size: 0.6 } });
  assert.equal(seen.size, 0.6, 'explicit runtime value wins');
  assert.equal(seen.color, '#aa2233', 'skin wins over visual variant color');
  assert.equal(seen.enabled, false, 'source variant wins over base');
  assert.equal(seen.finish, 'metal', 'base edit is inherited');
  assert.throws(() => validateEditorState(def, { ...edits, base: { missing: 1 } }), /not editable/);
  assert.throws(() => validateEditorState(def, { ...edits, base: { enabled: 'yes' } }), /invalid boolean/);
  assert.throws(() => validateEditorState(def, { ...edits, base: { finish: 'wood' } }), /invalid option/);
  assert.throws(() => defineAsset({ meta: { title: 'Bad default' }, params: { size: 2 }, editor: { version: 1, groups: [{ id: 'g', label: 'G' }], controls: [{ key: 'size', label: 'Size', group: 'g', type: 'number', min: 0, max: 1, step: 0.1 }] }, build() {} }), /invalid value/);
  assert.throws(() => defineAsset({ meta: { title: 'Bad options' }, params: { finish: 'paint' }, editor: { version: 1, groups: [{ id: 'g', label: 'G' }], controls: [{ key: 'finish', label: 'Finish', group: 'g', type: 'select', options: [{ value: 'paint', label: 'Paint' }, { value: 'paint', label: 'Again' }] }] }, build() {} }), /unique labeled options/);
  assert.throws(() => defineAsset({ meta: { title: 'Bad skin' }, skins: { red: { seed: 2 } }, build() {} }), /cannot change the seed/);
});

test('save rejects a source change during thumbnail without publishing a version', async () => {
  const file = path.join(assetDir, 'asset.js');
  const original = fs.readFileSync(file, 'utf8');
  const before = history.listVersions(slug);
  const head = history.workingState(slug).head?.id;
  const folders = fs.readdirSync(history.historyDir(slug)).sort();
  try {
    await assert.rejects(history.saveVersion(slug, {
      note: 'racing source', force: true,
      build: async (s, variant) => (await buildItem({ slug: s, variant, profileId: 'generic' })).report,
      thumbnail: async () => fs.appendFileSync(file, '\n// changed during thumbnail\n'),
    }), /source changed while saving/);
    assert.equal(history.workingState(slug).head?.id, head);
    assert.deepEqual(history.listVersions(slug), before);
    assert.deepEqual(fs.readdirSync(history.historyDir(slug)).sort(), folders);
  } finally { fs.writeFileSync(file, original); }
});

test('restore preserves dirty source and head when autosave build fails', async () => {
  const file = editor.editorFile(slug);
  const existed = fs.existsSync(file);
  const original = existed ? fs.readFileSync(file, 'utf8') : null;
  const head = history.workingState(slug).head?.id;
  const versions = history.listVersions(slug);
  assert.ok(head);
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, base: { size: 'invalid' }, variants: {} }));
    const dirtyText = fs.readFileSync(file, 'utf8');
    await assert.rejects(history.revertVersion(slug, head, { build: async (s, variant) => (await buildItem({ slug: s, variant, profileId: 'generic' })).report }), /invalid editor\.json/);
    assert.equal(fs.readFileSync(file, 'utf8'), dirtyText);
    assert.equal(history.workingState(slug).head?.id, head);
    assert.deepEqual(history.listVersions(slug), versions);
  } finally {
    if (existed) fs.writeFileSync(file, original);
    else fs.rmSync(file, { force: true });
  }
});

test('build rejects a source change during validation and leaves preview untouched', async () => {
  const file = path.join(assetDir, 'asset.js');
  const original = fs.readFileSync(file, 'utf8');
  await buildItem({ slug, profileId: 'generic', force: true });
  const beforeGlb = fs.readFileSync(previewGlb(slug, null, 'generic'));
  const beforeReport = fs.readFileSync(previewReport(slug, null, 'generic'));
  const validateBytes = validator.validateBytes;
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  validator.validateBytes = async (...args) => { entered(); await gate; return validateBytes(...args); };
  try {
    const build = buildItem({ slug, profileId: 'generic', force: true });
    await started;
    fs.appendFileSync(file, '\n// changed during validation\n');
    release();
    await assert.rejects(build, /source changed while building/);
    assert.deepEqual(fs.readFileSync(previewGlb(slug, null, 'generic')), beforeGlb);
    assert.deepEqual(fs.readFileSync(previewReport(slug, null, 'generic')), beforeReport);
  } finally {
    release();
    validator.validateBytes = validateBytes;
    fs.writeFileSync(file, original);
  }
});

test('build SSE and state identify the same source revision as the API response', async () => {
  const server = await startServer({ port: 0 });
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 30000);
  try {
    const events = await fetch(`${server.info.url}api/events`, { signal: abort.signal });
    const reader = events.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const next = async (wanted) => {
      while (true) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = frame.match(/^event: ([^\n]+)/m)?.[1];
          if (event === wanted) return JSON.parse(frame.match(/^data: (.+)$/m)?.[1] || '{}');
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`SSE closed before ${wanted}`);
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };
    await next('hello');
    const revision = editor.editorRevision(slug);
    const build = fetch(`${server.info.url}api/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, profile: 'generic' }) });
    const started = await next('build-start');
    assert.equal(started.revision, revision);
    const stateDuring = await (await fetch(`${server.info.url}api/state`)).json();
    if (stateDuring.building) assert.equal(stateDuring.building.revision, revision);
    const finished = await next('built');
    assert.equal(finished.revision, revision);
    assert.equal((await (await build).json()).revision, revision);
    await reader.cancel();
  } finally {
    clearTimeout(timeout);
    abort.abort();
    server.close();
  }
});
