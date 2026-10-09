// Browser smoke test for the scene composer, using copies of real assets and throwaway state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './helpers.js';

const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'];

test('scene composer places, snaps, edits, versions and strictly exports a room', { timeout: 420_000 }, async () => {
  const assets = fs.mkdtempSync(path.join(ROOT, '.tmp-scene-ui-'));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-scene-ui-state-'));
  const sets = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-scene-ui-sets-'));
  const scenes = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-scene-ui-scenes-'));
  for (const slug of ['minimalist-chair', 'realistic-crate', 'wasteland-oil-drum']) {
    fs.mkdirSync(path.join(assets, slug));
    fs.copyFileSync(path.join(ROOT, 'assets', slug, 'asset.js'), path.join(assets, slug, 'asset.js'));
  }
  Object.assign(process.env, {
    STUDIO_ASSETS_DIR: assets,
    STUDIO_SETS_DIR: sets,
    STUDIO_SCENES_DIR: scenes,
    STUDIO_STATE_DIR: state,
    STUDIO_EXPORTS_DIR: path.join(state, 'exports'),
    STUDIO_NO_NOTIFY: '1',
  });
  const { startServer } = await import('../studio/server/server.js');
  const server = await startServer({ port: 0 });
  const sceneFile = path.join(scenes, 'test-lobby', 'scene.json');
  const onDisk = () => JSON.parse(fs.readFileSync(sceneFile, 'utf8'));
  let browser;
  try {
    browser = await chromium.launch({ args: CHROMIUM_ARGS, ...(process.env.STUDIO_CHROMIUM ? { executablePath: process.env.STUDIO_CHROMIUM } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.info.url);
    await page.locator('#assetList .asset').first().waitFor();
    const saved = () => page.waitForFunction(() => document.querySelector('#sceneStatus')?.textContent.startsWith('Autosaved'), null, { timeout: 90_000 });
    // Wait until scene.json on disk satisfies `check` (the autosave is debounced).
    const disk = async (check, what) => {
      const end = Date.now() + 60_000;
      let last;
      for (;;) {
        try {
          last = onDisk();
          if (check(last)) return last;
        } catch {
          // mid-write
        }
        if (Date.now() > end) assert.fail(`scene.json never showed: ${what} (last: ${JSON.stringify(last?.instances)} ${JSON.stringify(last?.room)})`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    const instanceCount = (n) => page.waitForFunction((count) => document.querySelectorAll('#sceneOutliner [data-instance]').length === count, n, { timeout: 90_000 });

    // Create a 5 × 4 × 3 m room.
    await page.locator('#sideScenes').click();
    await page.locator('#sceneNew').click();
    await page.locator('#sceneNewName').fill('Test Lobby');
    await page.locator('#sceneNewW').fill('5');
    await page.locator('#sceneNewForm button[type="submit"]').click();
    await page.locator('#sceneRoom [data-room-field="width"]').waitFor();
    await saved();
    assert.equal(await page.locator('#title').textContent(), 'Scene — Test Lobby');
    assert.deepEqual([onDisk().room.width, onDisk().room.depth, onDisk().instances.length], [5, 4, 0]);

    // Clicking a library card and then the floor places the asset on the grid. An asset
    // without a preview is built on first use; after that its card shows the real size.
    const card = page.locator('#sceneLibrary [data-place="realistic-crate"]');
    await card.waitFor();
    assert.equal(await card.locator('.library-size').textContent(), 'not built');
    await page.keyboard.press('p'); // plan view: screen position maps linearly to the floor
    await card.click();
    const placingReady = () => page.waitForFunction(() => document.querySelector('#sceneHint')?.textContent.startsWith('Placing'), null, { timeout: 90_000 });
    await placingReady();
    const canvas = await page.locator('#canvas').boundingBox();
    const center = [canvas.x + canvas.width / 2, canvas.y + canvas.height / 2];
    // Plan view fits 0.6 × the larger outer size (5.4 m) as half the screen height.
    const pxPerMeter = canvas.height / (2 * 5.4 * 0.6);
    const floor = (x, z) => [center[0] + x * pxPerMeter, center[1] + z * pxPerMeter];
    await page.mouse.move(...floor(0.6, 0.35));
    await page.mouse.click(...floor(0.6, 0.35));
    await instanceCount(1);
    let doc = await disk((d) => d.instances.length === 1, 'the placed crate');
    assert.equal(doc.instances[0].asset, 'realistic-crate');
    assert.equal(doc.instances[0].id, 'realistic-crate-1');
    assert.deepEqual(doc.instances[0].position, [0.5, 0, 0.25], 'snapped to the 25 cm grid on the floor');
    await page.waitForFunction(() => /^\d\.\d\d × \d\.\d\d × \d\.\d\d m$/.test(document.querySelector('#sceneLibrary [data-place="realistic-crate"] .library-size')?.textContent || ''), null, { timeout: 60_000 });
    await page.locator('#sceneLibrary [data-place="realistic-crate"] img.thumb:not(.thumb-pending)').waitFor({ timeout: 60_000 });

    // Near the back wall an asset turns its back to the wall and sits flush against it.
    await page.locator('#sceneLibrary [data-place="minimalist-chair"]').click();
    await placingReady();
    await page.mouse.move(...floor(-1, -1.7));
    await page.mouse.click(...floor(-1, -1.7));
    await instanceCount(2);
    doc = await disk((d) => d.instances.length === 2, 'the placed chair');
    const chair = doc.instances.find((inst) => inst.asset === 'minimalist-chair');
    const item = await (await page.request.get(`${server.info.url}api/scene/item?slug=minimalist-chair&profile=generic`)).json();
    assert.equal(chair.yaw, 0, 'front faces the room');
    assert.ok(Math.abs(chair.position[2] + item.bounds.min[2] + 2) < 2e-3, `chair back is on the wall (z ${chair.position[2]}, back ${item.bounds.min[2]})`);
    assert.equal(chair.position[0], -1);
    await page.keyboard.press('p');

    // Inspector edits, undo and redo.
    await page.locator('#sceneOutliner [data-instance="realistic-crate-1"]').click();
    await page.locator('#sceneInspector [data-inst-pos="0"]').fill('1.5');
    await page.locator('#sceneInspector [data-inst-pos="0"]').press('Enter');
    await disk((d) => d.instances[0].position[0] === 1.5, 'x = 1.5 from the inspector');
    await page.locator('#sceneInspector [data-inst-action="rotate-left"]').click();
    await disk((d) => d.instances[0].yaw === 90, 'yaw 90 after turning left');
    await page.locator('#sceneUndo').click();
    await disk((d) => d.instances[0].yaw === 0, 'yaw 0 after undo');
    await page.locator('#sceneRedo').click();
    await disk((d) => d.instances[0].yaw === 90, 'yaw 90 after redo');

    // Duplicate and delete.
    await page.locator('#sceneInspector [data-inst-action="duplicate"]').click();
    await instanceCount(3);
    doc = await disk((d) => d.instances.length === 3, 'the duplicate');
    assert.deepEqual(doc.instances.map((inst) => inst.id), ['realistic-crate-1', 'minimalist-chair-1', 'realistic-crate-2']);
    await page.locator('#sceneInspector [data-inst-action="delete"]').click();
    await instanceCount(2);
    await disk((d) => d.instances.length === 2, 'the duplicate deleted');

    // Room edits rebuild the shell; an opening that cannot fit is rejected and rolled back.
    await page.locator('#sceneRoom [data-room-field="depth"]').fill('5');
    await page.locator('#sceneRoom [data-room-field="depth"]').press('Enter');
    await disk((d) => d.room.depth === 5, 'room depth 5');
    await page.locator('#sceneRoom [data-room-action="add-door"]').click();
    doc = await disk((d) => d.room.openings.length === 1, 'a door');
    assert.deepEqual(doc.room.openings.map((o) => [o.wall, o.w, o.h]), [['front', 0.9, 2.1]]);
    await page.locator('#sceneRoom [data-opening-key="w"]').fill('9');
    await page.locator('#sceneRoom [data-opening-key="w"]').press('Enter');
    await page.locator('#sceneAlert:not(.hidden)').waitFor();
    assert.match(await page.locator('#sceneAlert').textContent(), /Change rejected: .*does not fit/);
    assert.equal(onDisk().room.openings[0].w, 0.9);
    await page.locator('#sceneAlert [data-alert-action=""]').click();

    // The scene report follows the edits.
    await page.waitForFunction(() => /ready to export/.test(document.querySelector('#sceneReportBox')?.textContent || ''), null, { timeout: 120_000 });
    assert.match(await page.locator('#sceneReportBox').textContent(), /2 of 2 asset\(s\)/);

    // Save a version, change the scene, restore it.
    await page.locator('#sceneSaveBtn').click();
    await page.locator('#sceneNote').fill('two props and a door');
    await page.locator('#sceneSaveForm button[type="submit"]').click();
    await page.locator('#sceneVersions .scene-version').first().waitFor();
    assert.match(await page.locator('#sceneVersions').textContent(), /v001\s+two props and a door/);
    await page.locator('#sceneOutliner [data-instance="minimalist-chair-1"]').click();
    await page.locator('#sceneInspector [data-inst-action="delete"]').click();
    await instanceCount(1);
    await disk((d) => d.instances.length === 1, 'the chair deleted');
    await page.locator('#sceneVersions [data-restore-version="v001"]').click();
    await instanceCount(2);
    await disk((d) => d.instances.length === 2, 'version v001 restored');

    // Strict export for Roblox: one GLB with every instance as its own node, in studs.
    await page.locator('#profile').selectOption('roblox');
    await page.waitForFunction(() => /Roblox/.test(document.querySelector('#sceneReportBox h3')?.textContent || ''), null, { timeout: 120_000 });
    await page.locator('#sceneExportBtn').click();
    await page.locator('#sceneExportResult a').first().waitFor({ timeout: 120_000 });
    const exported = path.join(state, 'exports', 'roblox', 'scenes', 'test-lobby.glb');
    assert.ok(fs.existsSync(exported), 'scene GLB exported');
    const layout = JSON.parse(fs.readFileSync(path.join(state, 'exports', 'roblox', 'scenes', 'test-lobby.layout.json'), 'utf8'));
    assert.deepEqual(layout.instances.map((inst) => inst.id), ['realistic-crate-1', 'minimalist-chair-1']);
    const { createIO } = await import('../studio/core/ir/to-gltf.js');
    const glb = await createIO().readBinary(new Uint8Array(fs.readFileSync(exported)));
    assert.deepEqual(glb.getRoot().getDefaultScene().listChildren().map((n) => n.getName()), ['room', 'realistic-crate-1', 'minimalist-chair-1']);
    assert.equal(glb.getRoot().getAsset().extras.studio.units.name, 'stud');

    // An edit from outside the browser (an agent, the CLI) shows up without a reload.
    const external = onDisk();
    external.instances.push({ id: 'drum-1', asset: 'wasteland-oil-drum', position: [-1.5, 0, 1.5], yaw: 0 });
    fs.writeFileSync(sceneFile, `${JSON.stringify(external, null, 2)}\n`);
    await instanceCount(3);
    await page.locator('#sceneOutliner [data-instance="drum-1"]').waitFor();

    // Blocks: select several, group them, nudge, repeat as an array, select by rectangle.
    // The panels re-render on the next frame, so wait for the outliner to show the selection.
    const selectedRows = () => page.locator('#sceneOutliner [data-instance].selected').evaluateAll((rows) => rows.map((row) => row.dataset.instance));
    const selection = async (expected) => {
      try {
        await page.waitForFunction((ids) => JSON.stringify([...document.querySelectorAll('#sceneOutliner [data-instance].selected')].map((row) => row.dataset.instance)) === JSON.stringify(ids), expected, { timeout: 15_000 });
      } catch {
        assert.deepEqual(await selectedRows(), expected, `page errors: ${errors.join(' | ') || 'none'}`);
      }
    };
    await page.locator('#sceneOutliner [data-instance="realistic-crate-1"]').click();
    await page.locator('#sceneOutliner [data-instance="minimalist-chair-1"]').click({ modifiers: ['Shift'] });
    await selection(['realistic-crate-1', 'minimalist-chair-1']);
    await page.locator('#sceneInspector h3', { hasText: 'Selection · 2 instances' }).waitFor();
    await page.locator('#sceneInspector [data-inst-action="group"]').click();
    doc = await disk((d) => d.instances.filter((inst) => inst.group === 'group-1').length === 2, 'two instances in group-1');
    assert.equal(doc.instances.find((inst) => inst.id === 'drum-1').group, undefined);
    // A group header selects the whole group; arrow keys move it one grid step as a block.
    await page.locator('#sceneOutliner [data-instance="drum-1"]').click();
    await selection(['drum-1']);
    await page.locator('#sceneOutliner [data-group="group-1"]').click();
    await selection(['realistic-crate-1', 'minimalist-chair-1']);
    const before = Object.fromEntries(doc.instances.map((inst) => [inst.id, inst.position]));
    await page.keyboard.press('ArrowRight');
    doc = await disk((d) => d.instances[0].position[0] === before['realistic-crate-1'][0] + 0.25, 'the group nudged 25 cm along X');
    assert.equal(doc.instances.find((inst) => inst.id === 'minimalist-chair-1').position[0], before['minimalist-chair-1'][0] + 0.25);
    assert.deepEqual(doc.instances.find((inst) => inst.id === 'drum-1').position, before['drum-1'], 'what is not selected stays');

    // Array: 1 column × 2 rows, 1.25 m apart along Z: one more copy of the group, in its own group.
    for (const [key, value] of [['columns', '1'], ['rows', '2'], ['dz', '1.25']]) {
      await page.locator(`#sceneArray [data-array="${key}"]`).fill(value);
      await page.locator(`#sceneArray [data-array="${key}"]`).press('Enter');
    }
    await page.locator('#sceneArray [data-array-create]', { hasText: '2 × 2 = 4 instances' }).waitFor();
    await page.locator('#sceneArray [data-array-create]').click();
    await instanceCount(5);
    doc = await disk((d) => d.instances.length === 5, 'the array copies');
    const crate = doc.instances.find((inst) => inst.id === 'realistic-crate-1');
    const crate2 = doc.instances.find((inst) => inst.id === 'realistic-crate-2');
    assert.deepEqual(crate2.position, [crate.position[0], crate.position[1], +(crate.position[2] + 1.25).toFixed(4)]);
    assert.deepEqual([crate2.yaw, crate2.group, doc.instances.find((inst) => inst.id === 'minimalist-chair-2').group], [crate.yaw, 'group-2', 'group-2']);
    await page.waitForFunction(() => document.querySelectorAll('#sceneOutliner [data-instance].selected').length === 4, null, { timeout: 15_000 });
    // The whole array is one undo step.
    await page.locator('#sceneUndo').click();
    await instanceCount(3);
    await disk((d) => d.instances.length === 3, 'the array undone');
    await page.locator('#sceneRedo').click();
    await instanceCount(5);
    await disk((d) => d.instances.length === 5, 'the array redone');

    // Plan view: a rectangle dragged on the floor selects what it touches (here only the drum).
    await page.keyboard.press('p');
    await page.waitForTimeout(300);
    const plan = await page.locator('#canvas').boundingBox();
    const planScale = plan.height / (2 * 5.4 * 0.6);
    const onFloor = (x, z) => [plan.x + plan.width / 2 + x * planScale, plan.y + plan.height / 2 + z * planScale];
    await page.mouse.move(...onFloor(-1.95, 1.05));
    await page.mouse.down();
    await page.mouse.move(...onFloor(-1.6, 1.4), { steps: 4 });
    await page.mouse.move(...onFloor(-1.1, 1.9), { steps: 4 });
    assert.equal(await page.locator('#sceneMarquee').isVisible(), true);
    await page.mouse.up();
    await selection(['drum-1']);
    assert.equal(await page.locator('#sceneMarquee').isVisible(), false);
    await page.keyboard.press('p');

    // Ungroup the first group again.
    await page.locator('#sceneOutliner [data-group="group-1"]').click();
    await page.locator('#sceneInspector [data-inst-action="ungroup"]').click();
    doc = await disk((d) => !d.instances.some((inst) => inst.group === 'group-1'), 'group-1 dissolved');
    assert.equal(doc.instances.filter((inst) => inst.group === 'group-2').length, 2);

    // The scale reference offers the Roblox rigs, and the asset view still works afterwards.
    await page.locator('#scaleRef').selectOption('r15');
    await page.locator('#sideAssets').click();
    await page.locator('#assetList [data-slug="realistic-crate"]').click();
    await page.waitForFunction(() => /realistic-crate \[roblox\]/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 120_000 });
    assert.equal(await page.locator('#sceneTools').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.close();
    for (const dir of [assets, state, sets, scenes]) fs.rmSync(dir, { recursive: true, force: true });
  }
});
