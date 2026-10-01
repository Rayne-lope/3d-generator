import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { ROOT, useFixtures } from './helpers.js';

// Assets live in a temporary folder inside the repo so their relative kit import resolves.
const assets = fs.mkdtempSync(path.join(ROOT, '.tmp-test-assets-'));
useFixtures({ assets });
after(() => fs.rmSync(assets, { recursive: true, force: true }));

const ASSET = (size, knob) => `import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: { title: 'History Test', category: 'prop' },
  seed: 1,
  params: { size: ${size}, knob: ${knob} },
  build({ p, k }) {
    const a = k.asset('history_test');
    const m = k.mat.pbr({ name: 'body', color: '#8a7766', roughness: 0.6 });
    a.add(k.mesh(k.geo.box(p.size, p.size, p.size, { base: true }), m));
    a.add(k.mesh(k.geo.sphere(p.knob, { base: true, segments: 12 }), m, { at: [0, p.size, 0] }));
    return a;
  },
});
`;

const slug = 'history-test';
const file = path.join(assets, slug, 'asset.js');
fs.mkdirSync(path.dirname(file), { recursive: true });
const write = (text) => fs.writeFileSync(file, text);
const read = () => fs.readFileSync(file, 'utf8');
write(ASSET(0.5, 0.1));

const history = await import('../studio/core/history.js');
const { buildItem } = await import('../studio/core/build.js');
const { heatmap } = await import('../studio/core/diff.js');
const build = async (s) => (await buildItem({ slug: s, profileId: 'generic' })).report;
const save = (note, extra = {}) => history.saveVersion(slug, { note, build, ...extra });

test('save snapshots source + GLB and skips when nothing changed', async () => {
  const r1 = await save('first');
  assert.equal(r1.version.id, 'v001');
  const dir = path.join(history.historyDir(slug), 'v001');
  for (const f of ['meta.json', 'generic.glb', 'source/asset/asset.js']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.ok(r1.version.triangles > 0);
  const again = await save('same again');
  assert.equal(again.skipped, true);
  assert.equal(history.listVersions(slug).length, 1);
});

test('undo walks back along parents; revert restores any version', async () => {
  write(ASSET(0.5, 0.2));
  const r2 = await save('bigger knob');
  assert.equal(r2.version.id, 'v002');
  assert.equal(r2.version.parent, 'v001');
  write(ASSET(0.8, 0.2));
  await save('bigger box');
  const u1 = await history.undo(slug, { build });
  assert.equal(u1.restored, 'v002');
  assert.equal(read(), ASSET(0.5, 0.2));
  const u2 = await history.undo(slug, { build });
  assert.equal(u2.restored, 'v001');
  assert.equal(read(), ASSET(0.5, 0.1));
  await assert.rejects(history.undo(slug, { build }), /first saved version/);
  const rv = await history.revertVersion(slug, 'v003', { build });
  assert.equal(rv.restored, 'v003');
  assert.equal(read(), ASSET(0.8, 0.2));
  assert.equal(history.workingState(slug).current.id, 'v003');
});

test('unsaved changes are auto-saved before undo/revert (nothing is lost)', async () => {
  write(ASSET(0.8, 0.3));
  assert.equal(history.workingState(slug).dirty, true);
  const u = await history.undo(slug, { build });
  assert.equal(u.restored, 'v003');
  assert.ok(u.autosaved, 'auto-save version id');
  const auto = history.getVersion(slug, u.autosaved);
  assert.equal(auto.auto, true);
  assert.equal(auto.parent, 'v003');
  assert.equal(read(), ASSET(0.8, 0.2));
  await history.revertVersion(slug, u.autosaved, { build });
  assert.equal(read(), ASSET(0.8, 0.3));
});

test('pruning keeps the last N plus pinned versions', async () => {
  history.setPinned(slug, 'v001', true);
  for (let i = 0; i < 4; i++) {
    write(ASSET(0.5 + i * 0.05, 0.15));
    await save(`step ${i}`, { keep: 3 });
  }
  const ids = history.listVersions(slug).map((v) => v.id);
  assert.ok(ids.includes('v001'), `pinned v001 kept: ${ids}`);
  assert.equal(ids.filter((id) => id !== 'v001').length, 3, `${ids}`);
  assert.equal(fs.existsSync(path.join(history.historyDir(slug), 'v002')), false);
  // ids are never reused after pruning
  write(ASSET(0.9, 0.15));
  const next = await save('after prune', { keep: 3 });
  assert.ok(Number(next.version.id.slice(1)) > Number(ids[ids.length - 1].slice(1)));
});

test('unified source diff shows only the changed lines', () => {
  const d = history.unifiedDiff(ASSET(0.5, 0.1), ASSET(0.5, 0.2), { label: 'asset.js', labels: ['v001', 'v002'] });
  const changed = d.split('\n').filter((l) => /^[+-][^+-]/.test(l));
  assert.deepEqual(changed, ['-  params: { size: 0.5, knob: 0.1 },', '+  params: { size: 0.5, knob: 0.2 },']);
  assert.match(d, /^@@ -4,5 \+4,5 @@$/m);
  assert.equal(history.unifiedDiff('a\nb', 'a\nb'), '');
});

test('diff heatmap marks only the changed region', () => {
  const img = (paint) => {
    const png = new PNG({ width: 64, height: 64 });
    for (let i = 0; i < png.data.length; i += 4) png.data.set([0x4b, 0x50, 0x57, 255], i);
    for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) png.data.set([180, 120, 60, 255], (y * 64 + x) * 4);
    if (paint) for (let y = 40; y < 52; y++) for (let x = 40; x < 52; x++) png.data.set([30, 30, 35, 255], (y * 64 + x) * 4);
    return png;
  };
  const same = heatmap(img(false), img(false));
  assert.equal(same.changed, 0);
  assert.equal(same.box, null);
  const h = heatmap(img(false), img(true));
  assert.ok(h.changed >= 100 && h.changed <= 144, `changed ${h.changed}`);
  assert.ok(h.box.x0 >= 0.6 && h.box.y0 >= 0.6, JSON.stringify(h.box));
  assert.ok(h.ratio > 0.03 && h.ratio < 0.07, `ratio ${h.ratio}`);
});
