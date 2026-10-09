// Browser smoke test for the visual inspector, using copies of real assets and throwaway state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './helpers.js';

const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'];

test('visual editor edits pilots, recovers work, versions and strictly exports active looks', { timeout: 360_000 }, async () => {
  const assets = fs.mkdtempSync(path.join(ROOT, '.tmp-editor-ui-'));
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-editor-ui-state-'));
  const sets = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-editor-ui-sets-'));
  const slugs = ['minimalist-chair', 'wasteland-oil-drum', 'medieval-street-lamp', 'realistic-crate'];
  for (const slug of slugs) {
    fs.mkdirSync(path.join(assets, slug));
    fs.copyFileSync(path.join(ROOT, 'assets', slug, 'asset.js'), path.join(assets, slug, 'asset.js'));
  }
  Object.assign(process.env, {
    STUDIO_ASSETS_DIR: assets,
    STUDIO_SETS_DIR: sets,
    STUDIO_STATE_DIR: state,
    STUDIO_EXPORTS_DIR: path.join(state, 'exports'),
    STUDIO_NO_NOTIFY: '1',
  });
  const { startServer } = await import('../studio/server/server.js');
  const server = await startServer({ port: 0 });
  let browser;
  try {
    browser = await chromium.launch({ args: CHROMIUM_ARGS, ...(process.env.STUDIO_CHROMIUM ? { executablePath: process.env.STUDIO_CHROMIUM } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.info.url);
    await page.locator('#assetList .asset').first().waitFor();

    await page.locator('#assetList [data-slug="minimalist-chair"]').click();
    await page.locator('#edit-seatWidth').waitFor();
    await page.locator('#quality').getByText(/Ready to export/).waitFor({ timeout: 60_000 });
    await page.locator('#edit-seatWidth').fill('48');
    await page.locator('#edit-seatWidth').press('Tab');
    await page.waitForFunction(async () => {
      const data = await (await fetch('/api/editor?slug=minimalist-chair&profile=generic')).json();
      return data.overrides.base.seatWidth === 0.48;
    });
    await page.locator('#quality').getByText(/Ready to export/).waitFor({ timeout: 60_000 });
    await page.locator('#edit-seatDepth').fill('46');
    await page.locator('#edit-seatDepth').press('Tab');
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=minimalist-chair')).json()).overrides.base.seatDepth === 0.46);
    await page.locator('#title').click();
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(async () => !Object.hasOwn((await (await fetch('/api/editor?slug=minimalist-chair')).json()).overrides.base, 'seatDepth'));
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=minimalist-chair')).json()).overrides.base.seatDepth === 0.46);
    await page.reload();
    await page.locator('#edit-seatDepth').waitFor();
    assert.equal(await page.locator('#edit-seatDepth').inputValue(), '46');
    await page.locator('#quality').getByText(/Ready to export/).waitFor({ timeout: 60_000 });
    await page.locator('#edit-seatWidth').fill('47');
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('#saveVersionForm:not(.hidden)').waitFor({ timeout: 60_000 });
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=minimalist-chair')).json()).overrides.base.seatWidth === 0.47);
    assert.equal(await page.locator('#versionNote').evaluate((input) => input.validity.valueMissing), true);
    await page.locator('#cancelSaveVersion').click();

    await page.locator('#variantBar [data-variant="walnut"]').click();
    const oak = page.locator('[data-control="oak"] [data-role="hex"]');
    await oak.waitFor();
    assert.equal(await oak.inputValue(), '#7a5236');
    await oak.fill('#336699');
    await oak.press('Tab');
    await page.waitForFunction(async () => {
      const data = await (await fetch('/api/editor?slug=minimalist-chair&variant=walnut&profile=generic')).json();
      return data.overrides.variants.walnut?.oak === '#336699';
    });
    await page.locator('[data-control="oak"] [data-reset="oak"]').click();
    await page.waitForFunction(async () => {
      const data = await (await fetch('/api/editor?slug=minimalist-chair&variant=walnut&profile=generic')).json();
      return !Object.hasOwn(data.overrides.variants.walnut || {}, 'oak');
    });
    assert.equal(await oak.inputValue(), '#7a5236');
    await page.locator('#undoEdit').click();
    await page.waitForFunction(async () => {
      const data = await (await fetch('/api/editor?slug=minimalist-chair&variant=walnut&profile=generic')).json();
      return data.overrides.variants.walnut?.oak === '#336699';
    });
    await page.locator('#redoEdit').click();
    await page.waitForFunction(async () => {
      const data = await (await fetch('/api/editor?slug=minimalist-chair&variant=walnut&profile=generic')).json();
      return !Object.hasOwn(data.overrides.variants.walnut || {}, 'oak');
    });
    await page.locator('#quality').getByText(/Ready to export/).waitFor({ timeout: 60_000 });
    await page.locator('#title').click();
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('#saveVersionForm:not(.hidden)').waitFor();
    assert.equal(await page.locator('#versionNote').evaluate((input) => input.validity.valueMissing), true);
    await page.locator('#versionNote').fill('Chair width and walnut review');
    await page.locator('#saveVersionForm button[type="submit"]').click();
    await page.locator('[data-tab="versions"]').click();
    await page.locator('#tab-versions').getByText('Chair width and walnut review').waitFor({ timeout: 60_000 });
    await page.locator('#tab-versions .version[data-version="minimalist-chair|v001"] .v').click();
    await page.locator('#quality').getByText(/Historical preview/).waitFor();
    assert.equal(await page.locator('#profile').isDisabled(), true);
    await page.waitForFunction(() => document.querySelector('#tab-report')?.textContent?.includes('Saved version'));
    await page.locator('#tab-versions [data-restore="v001"]').click();
    await page.locator('#quality').getByText(/Ready to export/).waitFor({ timeout: 60_000 });
    assert.equal(await page.locator('#profile').isDisabled(), false);

    await page.locator('#exportBtn').click();
    await page.locator('[data-tab="edit"]').click();
    await page.locator('#exportResult a').first().waitFor({ timeout: 90_000 });
    assert.ok(fs.existsSync(path.join(state, 'exports', 'generic', 'minimalist-chair--walnut.glb')));
    assert.equal(new URL(await page.locator('#exportResult a').first().getAttribute('href'), server.info.url).pathname, '/files/exports/generic/minimalist-chair--walnut.glb');

    await page.locator('#assetList [data-slug="wasteland-oil-drum"]').click();
    await page.locator('#edit-paint').waitFor();
    assert.equal(await page.locator('#edit-height').inputValue(), '88');
    await page.locator('#variantBar [data-variant="fresh"]').click();
    const drumPaint = page.locator('[data-control="paint"] [data-role="hex"]');
    await drumPaint.waitFor();
    assert.equal(await drumPaint.inputValue(), '#2f5d8f');
    await drumPaint.fill('#37639a');
    await drumPaint.press('Tab');
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=wasteland-oil-drum&variant=fresh')).json()).overrides.variants.fresh?.paint === '#37639a');
    await page.locator('#edit-rust').fill('0.25');
    await page.locator('#edit-rust').press('Tab');
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=wasteland-oil-drum&variant=fresh')).json()).overrides.variants.fresh?.rust === 0.25);
    await page.reload();
    await page.locator('#assetList [data-slug="wasteland-oil-drum"]').click();
    await page.locator('#variantBar [data-variant="fresh"]').click();
    await drumPaint.waitFor();
    assert.equal(await drumPaint.inputValue(), '#37639a');
    assert.equal(await page.locator('#edit-rust').inputValue(), '0.25');
    await page.locator('[data-control="paint"] [data-reset="paint"]').click();
    await page.waitForFunction(async () => !Object.hasOwn((await (await fetch('/api/editor?slug=wasteland-oil-drum&variant=fresh')).json()).overrides.variants.fresh || {}, 'paint'));
    assert.equal(await drumPaint.inputValue(), '#2f5d8f');

    await page.locator('#assetList [data-slug="medieval-street-lamp"]').click();
    await page.locator('#edit-ironMetalness').waitFor();
    assert.equal(await page.locator('#edit-ironMetalness').inputValue(), '1');
    await page.locator('#variantBar [data-variant="unlit"]').click();
    await page.locator('#edit-glow').waitFor();
    assert.equal(await page.locator('#edit-glow').inputValue(), '0');
    await page.locator('#edit-glow').fill('0.5');
    await page.locator('#edit-glow').press('Tab');
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=medieval-street-lamp&variant=unlit')).json()).overrides.variants.unlit?.glow === 0.5);
    await page.locator('#edit-ironMetalness').selectOption('0');
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=medieval-street-lamp&variant=unlit')).json()).overrides.variants.unlit?.ironMetalness === 0);
    await page.reload();
    await page.locator('#assetList [data-slug="medieval-street-lamp"]').click();
    await page.locator('#variantBar [data-variant="unlit"]').click();
    await page.locator('#edit-glow').waitFor();
    assert.equal(await page.locator('#edit-glow').inputValue(), '0.5');
    assert.equal(await page.locator('#edit-ironMetalness').inputValue(), '0');
    await page.locator('#profile').selectOption('roblox');
    await page.locator('#quality').getByText(/Ready with .*warning/).waitFor({ timeout: 60_000 });
    assert.equal(await page.locator('#exportBtn').isEnabled(), true);
    await page.locator('#exportBtn').click();
    await page.locator('#exportResult a').first().waitFor({ timeout: 90_000 });
    assert.ok(fs.existsSync(path.join(state, 'exports', 'roblox', 'medieval-street-lamp--unlit.glb')));
    assert.equal(new URL(await page.locator('#exportResult a').first().getAttribute('href'), server.info.url).pathname, '/files/exports/roblox/medieval-street-lamp--unlit.glb');
    await page.locator('#profile').selectOption('generic');
    await page.locator('#quality').getByText(/Ready to export/).waitFor({ timeout: 60_000 });

    await page.locator('#assetList [data-slug="minimalist-chair"]').click();
    await page.locator('#edit-seatWidth').waitFor();
    await page.locator('#quality').getByText(/Ready to export/).waitFor({ timeout: 60_000 });
    const editorRoute = /\/api\/editor(?:\?|$)/;
    let delayed = false;
    const delayFirstPut = async (route) => {
      if (route.request().method() === 'PUT' && !delayed) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      await route.continue();
    };
    await page.route(editorRoute, delayFirstPut);
    await page.locator('#edit-seatWidth').fill('49');
    await page.locator('#edit-seatWidth').press('Tab');
    await page.locator('#edit-seatWidth').fill('50');
    await page.locator('#edit-seatWidth').press('Tab');
    await page.waitForFunction(async () => {
      const data = await (await fetch('/api/editor?slug=minimalist-chair&profile=generic')).json();
      return data.overrides.base.seatWidth === 0.5 && data.preview.current;
    }, null, { timeout: 60_000 });
    await page.locator('#quality').getByText(/Ready to export/).waitFor({ timeout: 60_000 });
    await page.unroute(editorRoute, delayFirstPut);
    await page.evaluate(async () => {
      const look = { slug: 'minimalist-chair', variant: null, skin: null, profile: 'generic', revision: 'obsolete-source', error: 'obsolete build failure' };
      await fetch('/api/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'build-start', ...look, items: [look] }) });
    });
    await page.waitForTimeout(300);
    assert.doesNotMatch(await page.locator('#banner').textContent(), /obsolete build failure/);
    assert.match(await page.locator('#quality').textContent(), /Ready to export/);

    let abortNext = true;
    const abortFirstPut = async (route) => {
      if (route.request().method() === 'PUT' && abortNext) {
        abortNext = false;
        await route.abort('failed');
      } else await route.continue();
    };
    await page.route(editorRoute, abortFirstPut);
    await page.locator('#edit-seatDepth').fill('47');
    await page.locator('#edit-seatDepth').press('Tab');
    await page.locator('#editAlert').getByText(/Could not save edit/).waitFor();
    assert.match(await page.evaluate(() => sessionStorage.getItem('studio.editor.recovery.minimalist-chair.base')), /seatDepth/);
    await page.locator('#editAlert').getByRole('button', { name: 'Retry' }).click();
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=minimalist-chair')).json()).overrides.base.seatDepth === 0.47);
    await page.unroute(editorRoute, abortFirstPut);

    abortNext = true;
    await page.route(editorRoute, abortFirstPut);
    await page.locator('#edit-seatDepth').fill('48');
    await page.locator('#edit-seatDepth').press('Tab');
    await page.locator('#editAlert').getByText(/Could not save edit/).waitFor();
    await page.reload();
    await page.locator('#editAlert').getByText(/interrupted before the studio confirmed/).waitFor();
    await page.locator('#editAlert').getByRole('button', { name: 'Reapply draft' }).click();
    await page.waitForFunction(async () => (await (await fetch('/api/editor?slug=minimalist-chair')).json()).overrides.base.seatDepth === 0.48);
    // The server has the value before the page has handled the PUT response: wait for the page too.
    await page.waitForFunction(() => sessionStorage.getItem('studio.editor.recovery.minimalist-chair.base') === null);
    await page.unroute(editorRoute, abortFirstPut);

    let wroteExternally = false;
    const conflictPut = async (route) => {
      if (route.request().method() === 'PUT' && !wroteExternally) {
        wroteExternally = true;
        const current = await (await fetch(`${server.info.url}api/editor?slug=minimalist-chair`)).json();
        const response = await fetch(`${server.info.url}api/editor`, {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: 'minimalist-chair', scope: 'base', values: { ...current.overrides.base, oakRoughness: 0.5 }, expectedRevision: current.revision }),
        });
        assert.equal(response.status, 200);
      }
      await route.continue();
    };
    await page.route(editorRoute, conflictPut);
    await page.locator('#edit-seatWidth').fill('51');
    await page.locator('#edit-seatWidth').press('Tab');
    await page.locator('#editAlert').getByText(/source changed outside this editor/).waitFor();
    await page.locator('#editAlert').getByRole('button', { name: 'Reapply draft' }).click();
    await page.waitForFunction(async () => {
      const data = await (await fetch('/api/editor?slug=minimalist-chair')).json();
      return data.overrides.base.seatWidth === 0.51 && data.overrides.base.oakRoughness === 0.5;
    });
    await page.unroute(editorRoute, conflictPut);

    await page.setViewportSize({ width: 900, height: 650 });
    await page.locator('[data-tab="edit"]').click();
    await page.locator('#edit-seatRoughness').scrollIntoViewIfNeeded();
    const inspector = await page.locator('#tab-edit').boundingBox();
    const lowerControl = await page.locator('#edit-seatRoughness').boundingBox();
    assert.ok(inspector && lowerControl && lowerControl.y >= inspector.y && lowerControl.y + lowerControl.height <= inspector.y + inspector.height + 2);
    assert.ok((await page.locator('#canvas').boundingBox()).width > 300);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.locator('#assetList [data-slug="realistic-crate"]').click();
    await page.locator('#tab-report.on').waitFor();
    assert.match(await page.locator('#editFields').innerText(), /available for preview/i);
    assert.equal(await page.locator('#saveVersionBtn').isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.close();
    fs.rmSync(assets, { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(sets, { recursive: true, force: true });
  }
});
