import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { ROOT } from './helpers.js';

const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'];

async function projectedPivot(page, slug, id, profile = 'generic') {
  return page.evaluate(async ({ slug, id, profile }) => {
    const THREE = await import('three');
    const { frameCamera } = await import('/viewport/scene-setup.js');
    const editor = await (await fetch(`/api/editor?slug=${slug}&profile=${profile}`)).json();
    const { report } = await (await fetch(`/api/report?slug=${slug}&profile=${profile}`)).json();
    const bounds = new THREE.Box3(new THREE.Vector3(...report.bounds.min), new THREE.Vector3(...report.bounds.max));
    const canvas = document.getElementById('canvas');
    const rect = canvas.getBoundingClientRect();
    const camera = new THREE.PerspectiveCamera(35, rect.width / rect.height, 0.01, 1000);
    frameCamera(camera, bounds, 'front');
    const part = editor.parts.find((entry) => entry.id === id);
    const p = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(part.effective.worldMatrix));
    p.multiplyScalar(report.profile.units.perMeter).project(camera);
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }, { slug, id, profile });
}

async function visibleLidPixels(page) {
  const shot = PNG.sync.read(await page.screenshot());
  let visible = 0;
  for (let y = 240; y < 425; y++) for (let x = 590; x < 945; x++) {
    const i = (y * shot.width + x) * 4;
    if (Math.abs(shot.data[i] - 75) + Math.abs(shot.data[i + 1] - 80) + Math.abs(shot.data[i + 2] - 87) > 70) visible++;
  }
  return visible;
}

test('parts hierarchy, selection, numeric transforms, variant inheritance and export', { timeout: 240_000 }, async () => {
  const assets = fs.mkdtempSync(path.join(ROOT, '.tmp-editor-parts-ui-'));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-editor-parts-ui-'));
  const sets = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-editor-parts-sets-'));
  for (const slug of ['pirate-treasure-chest', 'cartoon-mailbox', 'steampunk-pressure-valve']) {
    fs.mkdirSync(path.join(assets, slug));
    fs.copyFileSync(path.join(ROOT, 'assets', slug, 'asset.js'), path.join(assets, slug, 'asset.js'));
  }
  Object.assign(process.env, { STUDIO_ASSETS_DIR: assets, STUDIO_SETS_DIR: sets, STUDIO_STATE_DIR: state,
    STUDIO_EXPORTS_DIR: path.join(state, 'exports'), STUDIO_NO_NOTIFY: '1' });
  const { startServer } = await import('../studio/server/server.js');
  const server = await startServer({ port: 0 });
  let browser;
  try {
    browser = await chromium.launch({ args: CHROMIUM_ARGS, ...(process.env.STUDIO_CHROMIUM ? { executablePath: process.env.STUDIO_CHROMIUM } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.info.url);
    await page.locator('#assetList [data-slug="pirate-treasure-chest"]').click();
    await page.locator('#sideParts').click();
    await page.locator('#partList [data-part-id="lid"]').click();
    await page.locator('.part-inspector[data-part="lid"]').waitFor();
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    const x = page.locator('[data-part-id="lid"][data-part-field="move"][data-part-axis="0"]');
    assert.equal(await x.inputValue(), '0');
    await x.fill('10');
    await x.press('Tab');
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=pirate-treasure-chest')).json()).partTransforms.overrides.base.lid?.move[0] === 0.1);
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await page.locator('#title').click();
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(async () => !Object.hasOwn((await (await fetch('/api/editor?slug=pirate-treasure-chest')).json()).partTransforms.overrides.base, 'lid'));
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=pirate-treasure-chest')).json()).partTransforms.overrides.base.lid?.move[0] === 0.1);
    await page.locator('#variantBar [data-variant="open"]').click();
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=pirate-treasure-chest&variant=open')).json()).partTransforms.origins.lid === 'base');
    const y = page.locator('[data-part-id="lid"][data-part-field="move"][data-part-axis="1"]');
    await y.fill('5');
    await y.press('Tab');
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=pirate-treasure-chest&variant=open')).json()).partTransforms.overrides.variants.open?.lid?.move[1] === 0.05);
    await page.reload();
    await page.locator('#sideParts').click();
    await page.locator('#partList [data-part-id="lid"]').click();
    await page.locator('#variantBar [data-variant="open"]').click();
    await page.locator('.part-inspector[data-part="lid"]').waitFor();
    assert.equal(await page.locator('[data-part-id="lid"][data-part-field="move"][data-part-axis="1"]').inputValue(), '5');
    await page.locator('[data-part-mode="rotate"]').click();
    assert.equal(await page.locator('[data-part-mode="rotate"]').getAttribute('class'), 'on');
    await page.locator('#partSnap').click();
    assert.equal(await page.locator('#partSnap').getAttribute('aria-pressed'), 'true');
    await page.locator('#profile').selectOption('roblox');
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await page.locator('[data-part-mode="translate"]').click();
    const sourceBeforeViewToggles = (await (await page.request.get(`${server.info.url}api/editor?slug=pirate-treasure-chest&variant=open&profile=roblox`)).json()).revision;
    const lidPixels = await visibleLidPixels(page);
    assert.ok(lidPixels > 2000, `lid should be visible before toggles (${lidPixels} pixels)`);
    const assertDraftVisible = async (label) => {
      await page.waitForTimeout(100);
      const count = await visibleLidPixels(page);
      assert.ok(count > lidPixels * 0.55, `${label} retained lid draft (${count}/${lidPixels} pixels)`);
      assert.deepEqual(errors, [], `${label} caused a browser rendering error`);
    };
    await page.locator('[data-toggle="dims"]').click();
    await assertDraftVisible('Dims off');
    await page.locator('[data-toggle="dims"]').click();
    await assertDraftVisible('Dims on');
    for (const mode of ['normals', 'uv', 'density', 'shaded']) {
      await page.locator('#viewMode').selectOption(mode);
      await assertDraftVisible(`View ${mode}`);
    }
    for (const overlay of ['wire', 'backfaces']) {
      await page.locator(`[data-toggle="${overlay}"]`).click();
      await assertDraftVisible(`${overlay} on`);
      await page.locator(`[data-toggle="${overlay}"]`).click();
      await assertDraftVisible(`${overlay} off`);
    }
    assert.equal((await (await page.request.get(`${server.info.url}api/editor?slug=pirate-treasure-chest&variant=open&profile=roblox`)).json()).revision, sourceBeforeViewToggles);
    const beforeDrag = await (await page.request.get(`${server.info.url}api/editor?slug=pirate-treasure-chest&variant=open&profile=roblox`)).json();
    await page.mouse.move(838, 509);
    await page.mouse.down();
    await page.mouse.move(897, 526, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(async (before) => {
      const now = await (await fetch('/api/editor?slug=pirate-treasure-chest&variant=open&profile=roblox')).json();
      return now.revision !== before && now.partTransforms.effective.lid.move[0] !== 0.1;
    }, beforeDrag.revision, { timeout: 30_000 });
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await page.locator('[data-part-mode="rotate"]').click();
    const beforeRotate = (await (await page.request.get(`${server.info.url}api/editor?slug=pirate-treasure-chest&variant=open&profile=roblox`)).json()).revision;
    await page.mouse.move(947, 480);
    await page.mouse.down();
    await page.mouse.move(920, 536, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(async (before) => {
      const now = await (await fetch('/api/editor?slug=pirate-treasure-chest&variant=open&profile=roblox')).json();
      return now.revision !== before && now.partTransforms.effective.lid.rotation.some((v, i) => Math.abs(v - [0, 0, 0, 1][i]) > 0.01);
    }, beforeRotate, { timeout: 30_000 });
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await page.locator('[data-part-mode="scale"]').click();
    const beforeScale = (await (await page.request.get(`${server.info.url}api/editor?slug=pirate-treasure-chest&variant=open&profile=roblox`)).json()).revision;
    await page.mouse.move(900, 473);
    await page.mouse.down();
    await page.mouse.move(945, 461, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(async (before) => {
      const now = await (await fetch('/api/editor?slug=pirate-treasure-chest&variant=open&profile=roblox')).json();
      return now.revision !== before && Math.abs(now.partTransforms.effective.lid.scale - 1) > 0.01;
    }, beforeScale, { timeout: 30_000 });
    for (const [slug, id] of [['cartoon-mailbox', 'flag'], ['steampunk-pressure-valve', 'handwheel']]) {
      await page.locator('#sideAssets').click();
      await page.locator(`#assetList [data-slug="${slug}"]`).click();
      await page.locator('#profile').selectOption('generic');
      await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
      await page.locator('#sideParts').click();
      await page.locator(`#partList [data-part-id="${id}"]`).click();
      await page.locator('[data-view="front"]').click();
      await page.locator('[data-part-mode="translate"]').click();
      const point = await projectedPivot(page, slug, id);
      const before = (await (await page.request.get(`${server.info.url}api/editor?slug=${slug}&profile=generic`)).json()).revision;
      await page.mouse.move(point.x + 67, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 108, point.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(async ({ slug, before, id }) => {
        const now = await (await fetch(`/api/editor?slug=${slug}&profile=generic`)).json();
        return now.revision !== before && Math.abs(now.partTransforms.effective[id].move[0]) > 0.001;
      }, { slug, before, id }, { timeout: 30_000 });
      await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    }
    await page.locator('[data-part-mode="select"]').click();
    await page.locator('#canvas').click({ position: { x: 8, y: 8 } });
    const pickPoint = await projectedPivot(page, 'steampunk-pressure-valve', 'handwheel');
    await page.mouse.click(pickPoint.x, pickPoint.y);
    await page.locator('#partList [data-part-id="handwheel"].selected').waitFor();
    const rawNode = page.locator('#partList [data-node-index]').first();
    await rawNode.waitFor();
    await rawNode.focus();
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await page.evaluate(() => document.activeElement?.dataset?.nodeIndex), await rawNode.getAttribute('data-node-index'));
    await rawNode.click();
    assert.match(await page.locator('#editFields').innerText(), /Exported GLB node · read-only/);
    await page.locator('#partList [data-part-id="handwheel"]').click();
    await page.locator('[data-part-mode="translate"]').click();
    const cancelPoint = await projectedPivot(page, 'steampunk-pressure-valve', 'handwheel');
    const beforeCancel = (await (await page.request.get(`${server.info.url}api/editor?slug=steampunk-pressure-valve`)).json()).revision;
    await page.mouse.move(cancelPoint.x + 67, cancelPoint.y);
    await page.mouse.down();
    await page.mouse.move(cancelPoint.x + 110, cancelPoint.y, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal((await (await page.request.get(`${server.info.url}api/editor?slug=steampunk-pressure-valve`)).json()).revision, beforeCancel);
    await page.locator('#canvas').click({ position: { x: 8, y: 8 } });
    assert.equal(await page.locator('#partList .selected').count(), 0);
    await page.locator('#partList [data-part-id="handwheel"]').click();
    await page.locator('[data-part-mode="translate"]').click();
    let abortOne = true;
    const abortEdit = async (route) => {
      if (route.request().method() === 'PUT' && abortOne) { abortOne = false; await route.abort('failed'); }
      else await route.continue();
    };
    await page.route(/\/api\/editor(?:\?|$)/, abortEdit);
    const retryPoint = await projectedPivot(page, 'steampunk-pressure-valve', 'handwheel');
    const beforeRetry = (await (await page.request.get(`${server.info.url}api/editor?slug=steampunk-pressure-valve`)).json()).revision;
    await page.mouse.move(retryPoint.x + 67, retryPoint.y);
    await page.mouse.down();
    await page.mouse.move(retryPoint.x + 115, retryPoint.y, { steps: 8 });
    await page.mouse.up();
    await page.locator('#editAlert').getByText(/Could not save edit/).waitFor();
    await page.locator('#partDraftBadge:not(.hidden)').waitFor();
    assert.equal((await (await page.request.get(`${server.info.url}api/editor?slug=steampunk-pressure-valve`)).json()).revision, beforeRetry);
    assert.equal(await page.locator('#exportBtn').isDisabled(), true);
    await page.locator('#editAlert').getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(async (before) => (await (await fetch('/api/editor?slug=steampunk-pressure-valve')).json()).revision !== before, beforeRetry);
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await page.locator('#partDraftBadge:not(.hidden)').waitFor({ state: 'hidden' });
    abortOne = true;
    const discardPoint = await projectedPivot(page, 'steampunk-pressure-valve', 'handwheel');
    const beforeDiscard = (await (await page.request.get(`${server.info.url}api/editor?slug=steampunk-pressure-valve`)).json()).revision;
    await page.mouse.move(discardPoint.x + 67, discardPoint.y);
    await page.mouse.down();
    await page.mouse.move(discardPoint.x + 110, discardPoint.y, { steps: 8 });
    await page.mouse.up();
    await page.locator('#editAlert').getByText(/Could not save edit/).waitFor();
    await page.locator('#partDraftBadge:not(.hidden)').waitFor();
    await page.locator('#editAlert').getByRole('button', { name: 'Discard draft' }).click();
    assert.equal((await (await page.request.get(`${server.info.url}api/editor?slug=steampunk-pressure-valve`)).json()).revision, beforeDiscard);
    await page.locator('#partDraftBadge:not(.hidden)').waitFor({ state: 'hidden' });
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await page.unroute(/\/api\/editor(?:\?|$)/, abortEdit);
    const valveX = page.locator('[data-part-id="handwheel"][data-part-field="move"][data-part-axis="0"]');
    await valveX.fill('12');
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('#saveVersionForm:not(.hidden)').waitFor({ timeout: 60_000 });
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=steampunk-pressure-valve')).json()).partTransforms.effective.handwheel.move[0] === 0.12);
    await page.locator('#versionNote').fill('Handwheel at twelve centimeters');
    await page.locator('#saveVersionForm button[type="submit"]').click();
    await page.locator('#editAlert').getByText(/Version saved/).waitFor({ timeout: 60_000 });
    await valveX.fill('18');
    await valveX.press('Tab');
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=steampunk-pressure-valve')).json()).partTransforms.effective.handwheel.move[0] === 0.18);
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await page.locator('[data-tab="versions"]').click();
    await page.locator('#tab-versions .version[data-version="steampunk-pressure-valve|v001"]').click();
    await page.locator('#quality').getByText(/Historical preview/).waitFor();
    await page.locator('[data-tab="edit"]').click();
    assert.equal(await valveX.inputValue(), '12');
    assert.equal(await valveX.isDisabled(), true);
    await page.locator('[data-tab="versions"]').click();
    await page.locator('#tab-versions [data-restore="v001"]').click();
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=steampunk-pressure-valve')).json()).partTransforms.effective.handwheel.move[0] === 0.12);
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await page.locator('[data-tab="edit"]').click();
    await page.locator('#sideParts').click();
    await page.locator('#partList [data-part-id="handwheel"]').click();
    await page.locator('[data-view="front"]').click();
    await page.locator('[data-part-mode="translate"]').click();
    let externalWrite = false;
    const conflictEdit = async (route) => {
      if (route.request().method() === 'PUT' && !externalWrite) {
        externalWrite = true;
        const current = await (await fetch(`${server.info.url}api/editor?slug=steampunk-pressure-valve`)).json();
        const old = current.partTransforms.effective.handwheel;
        const response = await fetch(`${server.info.url}api/editor`, { method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: 'steampunk-pressure-valve', scope: 'base', partTransforms: { ...current.partTransforms.overrides.base, handwheel: { ...old, move: [old.move[0], 0.1, old.move[2]] } }, expectedRevision: current.revision }) });
        assert.equal(response.status, 200);
      }
      await route.continue();
    };
    await page.route(/\/api\/editor(?:\?|$)/, conflictEdit);
    const conflictPoint = await projectedPivot(page, 'steampunk-pressure-valve', 'handwheel');
    await page.mouse.move(conflictPoint.x + 67, conflictPoint.y);
    await page.mouse.down();
    await page.mouse.move(conflictPoint.x + 109, conflictPoint.y, { steps: 8 });
    await page.mouse.up();
    await page.locator('#editAlert').getByText(/source changed outside this editor/).waitFor({ timeout: 30_000 });
    await page.locator('#partDraftBadge:not(.hidden)').waitFor();
    await page.locator('#editAlert').getByRole('button', { name: 'Reapply draft' }).click();
    await page.waitForFunction(async () => {
      const value = (await (await fetch('/api/editor?slug=steampunk-pressure-valve')).json()).partTransforms.effective.handwheel.move;
      return value[1] === 0.1 && Math.abs(value[0] - 0.12) > 0.001;
    }, null, { timeout: 60_000 });
    await page.unroute(/\/api\/editor(?:\?|$)/, conflictEdit);
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    const notifyFailure = async () => page.evaluate(async () => {
      const current = await (await fetch('/api/editor?slug=steampunk-pressure-valve&profile=generic')).json();
      await fetch('/api/notify', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ slug: 'steampunk-pressure-valve', variant: null, skin: null, profile: 'generic', revision: current.revision, error: 'simulated build failure' }] }) });
    });
    await notifyFailure();
    await page.locator('#editAlert').getByText(/Build failed: simulated build failure/).waitFor();
    assert.equal(await page.locator('#exportBtn').isDisabled(), true);
    assert.ok(await page.locator('#partList [data-part-id="handwheel"]').count());
    await page.locator('#editAlert').getByRole('button', { name: 'Retry build' }).click();
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await notifyFailure();
    await page.locator('#editAlert').getByText(/Build failed: simulated build failure/).waitFor();
    await page.locator('#editAlert').getByRole('button', { name: 'Undo edit' }).click();
    await page.waitForFunction(async () => {
      const value = (await (await fetch('/api/editor?slug=steampunk-pressure-valve')).json()).partTransforms.effective.handwheel.move;
      return value[0] === 0.12 && value[1] === 0.1;
    }, null, { timeout: 60_000 });
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await page.locator('#partList [data-part-id="handwheel"]').click();
    await page.locator('[data-view="front"]').click();
    await page.locator('[data-part-mode="translate"]').click();
    const switchPoint = await projectedPivot(page, 'steampunk-pressure-valve', 'handwheel');
    const beforeSwitch = (await (await page.request.get(`${server.info.url}api/editor?slug=steampunk-pressure-valve`)).json()).revision;
    await page.mouse.move(switchPoint.x + 67, switchPoint.y);
    await page.mouse.down();
    await page.mouse.move(switchPoint.x + 104, switchPoint.y, { steps: 7 });
    await page.evaluate(() => document.querySelector('#variantBar [data-variant="red-zone"]').click());
    await page.mouse.up();
    await page.locator('#variantBar [data-variant="red-zone"].on').waitFor();
    assert.equal((await (await page.request.get(`${server.info.url}api/editor?slug=steampunk-pressure-valve`)).json()).revision, beforeSwitch);
    await page.locator('#quality').getByText(/Ready/).waitFor({ timeout: 60_000 });
    await page.evaluate(async () => {
      const stale = { slug: 'steampunk-pressure-valve', variant: null, skin: null, profile: 'generic', revision: 'stale', error: 'old look failure' };
      await fetch('/api/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [stale] }) });
    });
    await page.waitForTimeout(250);
    assert.doesNotMatch(await page.locator('#editAlert').textContent(), /old look failure/);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.close();
    fs.rmSync(assets, { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(sets, { recursive: true, force: true });
  }
});
