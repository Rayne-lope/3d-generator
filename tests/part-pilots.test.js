// Independent end-to-end source/build/export checks for the authored part pilots.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.js';

const pilots = [
  { slug: 'pirate-treasure-chest', id: 'lid' },
  { slug: 'cartoon-mailbox', id: 'flag' },
  { slug: 'steampunk-pressure-valve', id: 'handwheel' },
];
const profiles = ['generic', 'godot', 'roblox'];
const assets = fs.mkdtempSync(path.join(ROOT, '.tmp-part-pilots-'));
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'part-pilots-state-'));
for (const { slug } of pilots) {
  fs.mkdirSync(path.join(assets, slug));
  fs.copyFileSync(path.join(ROOT, 'assets', slug, 'asset.js'), path.join(assets, slug, 'asset.js'));
}
Object.assign(process.env, { STUDIO_ASSETS_DIR: assets, STUDIO_SETS_DIR: path.join(state, 'sets'), STUDIO_STATE_DIR: state, STUDIO_EXPORTS_DIR: path.join(state, 'exports'), STUDIO_NO_NOTIFY: '1' });
after(() => { for (const dir of [assets, state]) fs.rmSync(dir, { recursive: true, force: true }); });

const { buildItem } = await import('../studio/core/build.js');
const { loadAssetDef } = await import('../studio/core/load-asset.js');
const { fingerprint, compareFingerprint } = await import('../studio/core/golden.js');
const { exportItem } = await import('../studio/core/export.js');
const { editorData, replaceEditorScope } = await import('../studio/core/editor.js');
const { withCapture } = await import('../studio/core/render/capture.js');
const { previewGlb } = await import('../studio/core/paths.js');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'golden', 'manifest.json'), 'utf8'));
const clean = (r, label) => assert.equal(r.counts.error, 0, `${label}: ${r.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ')}`);

test('part IDs add identity while all pilot default engine fingerprints stay unchanged', async () => {
  for (const { slug, id } of pilots) {
    const def = await loadAssetDef(slug);
    assert.ok(def.editor.parts.some(p => p.id === id));
    for (const variant of [null, ...Object.keys(def.variants)]) {
      for (const profileId of profiles) {
        const result = await buildItem({ slug, variant, profileId });
        clean(result.report, `${slug}/${variant}/${profileId}`);
        const item = `${slug}${variant ? `--${variant}` : ''}`;
        assert.deepEqual(compareFingerprint(manifest.items[`${profileId}/${item}`], fingerprint(result.report)), [], `${item}/${profileId}`);
        assert.ok(result.report.nodes.some(n => n.partId === id), `${item}/${profileId} exported ID`);
        assert.ok(result.report.parts.some(p => p.id === id && p.pivot.length === 3), `${item}/${profileId} source pivot`);
      }
    }
  }
});

test('all base and variant part edits retain parity, deterministic strict exports and source overrides', { timeout: 240_000 }, async () => {
  await withCapture(async (api) => {
    for (const { slug, id } of pilots) {
      const def = await loadAssetDef(slug);
      const initial = await editorData(slug);
      const baseDelta = { move: [0.01, 0.03, 0], rotation: [Math.sin(Math.PI / 72), 0, 0, Math.cos(Math.PI / 72)], scale: 1.05 };
      let next = await replaceEditorScope({ slug, scope: 'base', partTransforms: { [id]: baseDelta }, expectedRevision: initial.revision });
      for (const variant of [null, ...Object.keys(def.variants)]) {
        if (variant) {
          const inherited = await editorData(slug, { variant });
          assert.equal(inherited.partTransforms.effective[id].scale, 1.05);
          const variantDelta = { move: [-0.01, 0.02, 0.01], rotation: [0, Math.sin(Math.PI / 36), 0, Math.cos(Math.PI / 36)], scale: 0.95 };
          next = await replaceEditorScope({ slug, scope: 'variant', variant, partTransforms: { [id]: variantDelta }, expectedRevision: inherited.revision });
          assert.equal(next.partTransforms.effective[id].scale, 0.95);
          assert.deepEqual(next.partTransforms.effective[id].move, variantDelta.move);
        }
        for (const profileId of profiles) {
          const built = await buildItem({ slug, variant, profileId });
          clean(built.report, `${slug}/${variant}/${profileId}`);
          const fresh = await buildItem({ slug, variant, profileId, force: true, write: false });
          assert.deepEqual(fresh.glb, built.glb);
          const exported = await exportItem({ slug, variant, profileId, api });
          assert.equal(exported.blocked, false, exported.reason);
          assert.equal(exported.report.export.previewMatch, true);
          assert.equal(exported.parity.ok, true, `${slug}/${variant}/${profileId} parity`);
          const basename = `${slug}${variant ? `--${variant}` : ''}.glb`;
          assert.deepEqual(fs.readFileSync(path.join(state, 'exports', profileId, basename)), fs.readFileSync(previewGlb(slug, variant, profileId)));
        }
        if (variant) {
          const reset = await replaceEditorScope({ slug, scope: 'variant', variant, partTransforms: {}, expectedRevision: next.revision });
          assert.equal(reset.partTransforms.effective[id].scale, 1.05);
          assert.equal(reset.partTransforms.origins[id], 'base');
          next = reset;
        }
      }
      const resetBase = await replaceEditorScope({ slug, scope: 'base', partTransforms: {}, expectedRevision: next.revision });
      assert.equal(resetBase.partTransforms.effective[id].scale, 1);
      assert.equal(fs.existsSync(path.join(assets, slug, 'editor.json')), false);
    }
  });
});
