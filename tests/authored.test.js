// The golden suite and the engine packs run on authored copies of the golden assets:
// everything in the asset folder except the visual editor's working-copy overrides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyAuthoredSources, goldenSlugs } from '../studio/cli/authored.js';

test('authored copies leave editor.json out and keep every other file', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-authored-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-authored-out-'));
  for (const slug of ['chair', 'chest', 'lamp']) fs.mkdirSync(path.join(src, slug));
  fs.writeFileSync(path.join(src, 'chair', 'asset.js'), '// chair');
  fs.writeFileSync(path.join(src, 'chair', 'editor.json'), '{"version":1,"base":{"oak":"#ff0000"},"variants":{}}');
  fs.writeFileSync(path.join(src, 'chest', 'asset.js'), '// chest');
  fs.writeFileSync(path.join(src, 'chest', 'helper.js'), '// helper');
  fs.writeFileSync(path.join(src, 'chest', 'reference.png'), 'png');
  fs.writeFileSync(path.join(src, 'lamp', 'notes.txt'), 'no asset.js: not an asset');
  const result = copyAuthoredSources(src, ['chair', 'chest', 'lamp', 'missing'], out);
  assert.deepEqual(result, { copied: ['chair', 'chest'], ignoredOverrides: ['chair'] });
  assert.deepEqual(fs.readdirSync(path.join(out, 'chair')), ['asset.js']);
  assert.deepEqual(fs.readdirSync(path.join(out, 'chest')).sort(), ['asset.js', 'helper.js', 'reference.png']);
  assert.equal(fs.existsSync(path.join(out, 'lamp')), false);
  // The working copy is untouched.
  assert.equal(fs.existsSync(path.join(src, 'chair', 'editor.json')), true);
});

test('the golden list names real assets', () => {
  const slugs = goldenSlugs();
  assert.ok(slugs.length >= 20);
  assert.ok(slugs.includes('minimalist-chair') && slugs.includes('pirate-treasure-chest'));
});
