// CLI smoke test: new → build → save → edit → save → history → undo → revert → pin,
// run through `node studio` exactly like an agent would (no browser needed).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.js';

const assets = fs.mkdtempSync(path.join(ROOT, '.tmp-test-assets-'));
const sets = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sets-'));
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-state-'));
after(() => {
  for (const d of [assets, sets, state]) fs.rmSync(d, { recursive: true, force: true });
});

const env = { ...process.env, STUDIO_ASSETS_DIR: assets, STUDIO_SETS_DIR: sets, STUDIO_STATE_DIR: state, STUDIO_NO_NOTIFY: '1', NO_COLOR: '1' };
const studio = (...args) => execFileSync(process.execPath, ['studio', ...args], { cwd: ROOT, env, encoding: 'utf8' });
const json = (...args) => JSON.parse(studio(...args, '--json'));

test('agent loop through the CLI', () => {
  studio('new', 'cli-smoke', '--prompt', 'a small red crate', '--category', 'container', '--style', 'simple');
  const file = path.join(assets, 'cli-smoke', 'asset.js');
  assert.ok(fs.existsSync(file));
  const built = json('build', 'cli-smoke');
  assert.equal(built.results[0].ok, true);
  const first = fs.readFileSync(file, 'utf8');
  assert.equal(json('save', 'cli-smoke', '-m', 'a small red crate', '--no-thumb').version.id, 'v001');

  const edited = first.replace('width: 0.8,', 'width: 1.2,');
  assert.notEqual(edited, first);
  fs.writeFileSync(file, edited);
  const v2 = json('save', 'cli-smoke', '-m', 'make it wider', '--no-thumb');
  assert.equal(v2.version.id, 'v002');
  assert.equal(v2.version.parent, 'v001');
  assert.ok(v2.version.stats['cli-smoke'].dimensions[0] > 1.1);

  const h = json('history', 'cli-smoke');
  assert.deepEqual(h.versions.map((v) => v.note), ['a small red crate', 'make it wider']);
  assert.equal(h.current, 'v002');

  assert.equal(json('undo', 'cli-smoke', '--no-thumb').restored, 'v001');
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  assert.equal(json('revert', 'cli-smoke', 'v002', '--no-thumb').restored, 'v002');
  assert.equal(fs.readFileSync(file, 'utf8'), edited);
  assert.equal(json('pin', 'cli-smoke', 'v001').pinned, true);
  assert.match(studio('history', 'cli-smoke'), /v001 .*📌/);
});

test('save requires a message', () => {
  assert.throws(() => execFileSync(process.execPath, ['studio', 'save', 'cli-smoke'], { cwd: ROOT, env, encoding: 'utf8', stdio: 'pipe' }), /needs -m/);
});
