import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useFixtures, errors, issueIds } from './helpers.js';

useFixtures();
const { buildItem } = await import('../studio/core/build.js');
const { checkSource } = await import('../studio/core/validate/checks/source.js');

const build = (slug, profileId) => buildItem({ slug, profileId, write: false });
const severityOf = (report, id) => report.issues.find((i) => i.id === id)?.severity;

test('inverted winding is an error', async () => {
  const { report } = await build('fx-inverted', 'generic');
  assert.ok(errors(report).includes('geometry.inverted-faces') || errors(report).includes('geometry.inside-out'));
});

test('UV padding: 2 px gutters block Roblox export, 14 px pass', async () => {
  const bad = await build('fx-padding-bad', 'roblox');
  assert.equal(severityOf(bad.report, 'uv.padding'), 'error');
  const tex = bad.report.textures.find((t) => t.layout === 'atlas');
  assert.ok(tex.minPaddingPx < 8, `min padding ${tex.minPaddingPx}`);
  assert.ok(tex.paddingViolations.length > 0);
  const ok = await build('fx-padding-ok', 'roblox');
  assert.ok(!issueIds(ok.report).includes('uv.padding'), `padding ${ok.report.textures.find((t) => t.layout === 'atlas')?.minPaddingPx}`);
});

test('UV padding is a warning (not an error) for the generic profile', async () => {
  const { report } = await build('fx-padding-bad', 'generic');
  assert.equal(severityOf(report, 'uv.padding'), 'warning');
});

test('low texel density blocks Roblox and warns elsewhere', async () => {
  const r = await build('fx-lowdensity', 'roblox');
  assert.equal(severityOf(r.report, 'texture.low-density'), 'error');
  const g = await build('fx-lowdensity', 'generic');
  assert.equal(severityOf(g.report, 'texture.low-density'), 'warning');
});

test('source lint flags non-deterministic and non-portable code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-lint-'));
  const file = path.join(dir, 'asset.js');
  fs.writeFileSync(file, "const x = Math.random();\nimport fs from 'node:fs';\nconst m = new THREE.MeshBasicMaterial();\n// Math.random() in a comment is fine\n");
  const ids = checkSource({ files: [file] }).map((i) => i.id);
  assert.ok(ids.includes('source.random'));
  assert.ok(ids.includes('source.node-api'));
  assert.ok(ids.includes('source.material'));
});
