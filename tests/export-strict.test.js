import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useFixtures } from './helpers.js';

useFixtures();
const { exportItem } = await import('../studio/core/export.js');
const { buildItem } = await import('../studio/core/build.js');
const { fingerprint, compareFingerprint } = await import('../studio/core/golden.js');

test('export is blocked while validation errors remain (30k-triangle mesh on Roblox)', async () => {
  const r = await exportItem({ slug: 'fx-dense', profileId: 'roblox', parity: false });
  assert.equal(r.blocked, true);
  assert.ok(r.errors.some((e) => e.id === 'scene.mesh-triangles'), r.errors.map((e) => e.id).join(','));
  assert.equal(fs.existsSync(path.join(process.env.STUDIO_EXPORTS_DIR, 'roblox', 'fx-dense.glb')), false);
});

test('a clean asset exports GLB + reports, byte-identical to the preview', async () => {
  const r = await exportItem({ slug: 'kit-test', profileId: 'generic', parity: false });
  assert.equal(r.blocked, false, r.reason);
  const dir = path.join(process.env.STUDIO_EXPORTS_DIR, 'generic');
  const glb = fs.readFileSync(path.join(dir, 'kit-test.glb'));
  const preview = fs.readFileSync(path.join(process.env.STUDIO_STATE_DIR, 'preview', 'kit-test', 'generic.glb'));
  assert.ok(glb.equals(preview), 'export bytes equal the preview bytes');
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'kit-test.report.json'), 'utf8'));
  assert.equal(report.export.previewMatch, true);
  assert.equal(report.file.path.endsWith('generic/kit-test.glb'), true);
  const md = fs.readFileSync(path.join(dir, 'kit-test.report.md'), 'utf8');
  assert.match(md, /Preview = Export/);
  assert.match(md, /## Importing into Generic glTF/);
});

test('golden structure check notices a changed triangle count or material', async () => {
  const { report } = await buildItem({ slug: 'kit-test', profileId: 'generic', write: false });
  const a = fingerprint(report);
  assert.deepEqual(compareFingerprint(a, structuredClone(a)), []);
  const b = structuredClone(a);
  b.triangles += 12;
  b.materials[0].baseColor = '#000000';
  const problems = compareFingerprint(a, b);
  assert.ok(problems.some((p) => p.startsWith('triangles')), problems.join('; '));
  assert.ok(problems.some((p) => p.includes('changed')), problems.join('; '));
});
