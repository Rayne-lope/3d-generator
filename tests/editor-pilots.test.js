// Exercise authored pilot controls through the real three-profile build pipeline.
// Source and editor files are copied into isolated, disposable asset folders.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';

const pilots = ['minimalist-chair', 'wasteland-oil-drum', 'medieval-street-lamp'];
const profiles = ['generic', 'godot', 'roblox'];
const assetRoot = fs.mkdtempSync(path.join(ROOT, '.tmp-test-editor-pilots-'));
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-editor-pilots-'));
for (const slug of pilots) {
  fs.mkdirSync(path.join(assetRoot, slug));
  fs.copyFileSync(path.join(ROOT, 'assets', slug, 'asset.js'), path.join(assetRoot, slug, 'asset.js'));
}
process.env.STUDIO_ASSETS_DIR = assetRoot;
process.env.STUDIO_SETS_DIR = path.join(stateRoot, 'sets');
process.env.STUDIO_STATE_DIR = stateRoot;
process.env.STUDIO_EXPORTS_DIR = path.join(stateRoot, 'exports');
process.env.STUDIO_NO_NOTIFY = '1';
after(() => {
  fs.rmSync(assetRoot, { recursive: true, force: true });
  fs.rmSync(stateRoot, { recursive: true, force: true });
});

const { buildItem } = await import('../studio/core/build.js');
const { loadAssetDef } = await import('../studio/core/load-asset.js');
const { fingerprint, compareFingerprint } = await import('../studio/core/golden.js');
const { exportItem } = await import('../studio/core/export.js');
const { withCapture } = await import('../studio/core/render/capture.js');
const { parityCheck } = await import('../studio/core/review.js');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'golden', 'manifest.json'), 'utf8'));

function edits(slug, base = {}, variants = {}) {
  const file = path.join(assetRoot, slug, 'editor.json');
  if (!Object.keys(base).length && !Object.keys(variants).length) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, JSON.stringify({ version: 1, base, variants }));
}

function assertClean(report, context) {
  assert.equal(report.counts.error, 0, `${context}: ${report.issues.filter((i) => i.severity === 'error').map((i) => `${i.id}: ${i.message}`).join('; ')}`);
}

test('pilot base and authored variant defaults keep existing engine fingerprints', async () => {
  for (const slug of pilots) {
    const def = await loadAssetDef(slug);
    assert.equal(def.editor?.version, 1, `${slug} declares editor schema v1`);
    for (const variant of [null, ...Object.keys(def.variants)]) {
      for (const profileId of profiles) {
        const { report } = await buildItem({ slug, variant, profileId, write: false });
        const id = `${slug}${variant ? `--${variant}` : ''}`;
        assertClean(report, `${profileId}/${id}`);
        assert.deepEqual(compareFingerprint(manifest.items[`${profileId}/${id}`], fingerprint(report)), [], `${profileId}/${id} default structure`);
      }
    }
  }
});

test('each pilot control minimum and maximum remains valid in every engine profile', async () => {
  for (const slug of pilots) {
    const def = await loadAssetDef(slug);
    for (const control of def.editor.controls) {
      let values;
      if (control.type === 'number' || control.type === 'integer') values = [...new Set([control.min, control.max])];
      else if (control.type === 'select') values = control.options.map((o) => typeof o === 'object' ? o.value : o);
      else if (control.type === 'boolean') values = [false, true];
      else if (control.type === 'color') values = ['#19384f'];
      else throw new Error(`unhandled pilot control ${control.key}`);
      for (const value of values) {
        edits(slug, { [control.key]: value });
        try {
          for (const profileId of profiles) {
            const { report } = await buildItem({ slug, profileId, write: false });
            assertClean(report, `${slug}.${control.key}=${value} [${profileId}]`);
          }
        } finally { edits(slug); }
      }
    }
  }
});

test('edited pilot variants export deterministic GLBs matching the profile preview', async () => {
  const scenarios = [
    { slug: 'minimalist-chair', variant: 'walnut', base: { seatWidth: 0.48 }, values: { seat: '#504438', oakRoughness: 0.55 } },
    { slug: 'wasteland-oil-drum', variant: 'fresh', base: { height: 0.95 }, values: { rust: 0.2, dents: 1, paint: '#19384f' } },
    { slug: 'medieval-street-lamp', variant: 'unlit', base: { armLength: 0.85 }, values: { glow: 0.5, ironMetalness: 0, glass: '#f1b35a' } },
  ];
  for (const scenario of scenarios) {
    const { slug, variant, base, values } = scenario;
    edits(slug, base, { [variant]: values });
    try {
      for (const profileId of profiles) {
        const first = await buildItem({ slug, variant, profileId });
        assertClean(first.report, `${slug}--${variant} [${profileId}]`);
        const fresh = await buildItem({ slug, variant, profileId, force: true, write: false });
        assert.ok(Buffer.from(first.glb).equals(Buffer.from(fresh.glb)), 'independent build is deterministic');
        const exported = await exportItem({ slug, variant, profileId, parity: false });
        assert.equal(exported.blocked, false, exported.reason);
        const id = `${slug}--${variant}`;
        const preview = fs.readFileSync(path.join(stateRoot, 'preview', id, `${profileId}.glb`));
        const file = fs.readFileSync(path.join(stateRoot, 'exports', profileId, `${id}.glb`));
        assert.ok(preview.equals(file), `${id}/${profileId} strict export equals preview`);
      }
    } finally { edits(slug); }
  }
});

test('edited source and exported GLB parity includes base and variant sidecars in every profile', async () => {
  await withCapture(async (capture) => {
    const scenarios = [
      { slug: 'minimalist-chair', variant: 'walnut', base: { seatWidth: 0.48 }, values: { seat: '#504438' } },
      { slug: 'wasteland-oil-drum', variant: 'fresh', base: { height: 0.95 }, values: { rust: 0.2, paint: '#19384f' } },
      { slug: 'medieval-street-lamp', variant: 'unlit', base: { armLength: 0.85 }, values: { glow: 0.5, glass: '#f1b35a' } },
    ];
    for (const { slug, variant, base, values } of scenarios) {
      edits(slug, base, { [variant]: values });
      try {
        for (const profileId of profiles) {
          await buildItem({ slug, variant, profileId });
          const parity = await parityCheck(capture, { slug, variant, profileId, size: 256 });
          assert.equal(parity.ok, true, `${slug}--${variant} [${profileId}]: source/GLB parity ${parity.max}`);
        }
      } finally { edits(slug); }
    }
  });
});
