// Scene review: compose the scene, then render a contact sheet from the composed GLB
// (plan with labels, two dollhouse views, two eye-level views). Agents judge a layout from
// this sheet, the same way assets are judged from theirs.

import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer } from '../server/server.js';
import { ensureDir } from '../core/fsutil.js';
import { rel } from '../core/paths.js';
import { writeDataUrl } from '../core/render/image.js';
import { composeScene } from './compose.js';
import { readScene, SceneError } from './schema.js';
import { sceneShotsDir } from './paths.js';

const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'];

/** Run fn(call, baseUrl) with the headless capture page open; call(method, opts) → window.studioCapture[method](opts). */
async function withCapturePage(fn) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error("Playwright is not installed. Run 'npm install' in the repo.");
  }
  const options = { args: CHROMIUM_ARGS };
  if (process.env.STUDIO_CHROMIUM) options.executablePath = process.env.STUDIO_CHROMIUM;
  let browser;
  try {
    browser = await playwright.chromium.launch(options);
  } catch (err) {
    const fallback = ['/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
    if (fallback && !options.executablePath) browser = await playwright.chromium.launch({ ...options, executablePath: fallback });
    else throw new Error(`Could not start Chromium for headless renders: ${err.message.split('\n')[0]}\nRun 'npx playwright install chromium' (or set STUDIO_CHROMIUM to a Chrome/Chromium binary).`);
  }
  const server = await startStaticServer();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${server.url}capture`);
    await page.waitForFunction(() => window.studioReady === true, null, { timeout: 30000 });
    const call = async (method, opts) => {
      try {
        return await page.evaluate(([m, o]) => window.studioCapture[m](o), [method, opts]);
      } catch (err) {
        throw new Error(`capture.${method} failed: ${err.message.split('\n')[0]}${errors.length ? `\n${errors.slice(-3).join('\n')}` : ''}`);
      }
    };
    return await fn(call, server.url);
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * @param {{name: string, profileId?: string, size?: number}} opts
 * @returns {Promise<{name: string, profile: string, report: any, sheet: string, dir: string, views: Record<string, string>}>}
 */
export async function reviewScene({ name, profileId = 'generic', size = 640 }) {
  const { report } = await composeScene({ name, profileId });
  if (!report.file) throw new SceneError(`scene '${name}' has nothing to render: ${report.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ') || 'it is empty'}`);
  const { scene } = readScene(name);
  const dir = ensureDir(path.join(sceneShotsDir(name), profileId));
  const { tiles, sheet } = await withCapturePage(async (call, base) => {
    const rendered = await call('sceneViews', {
      url: `${base}files/scenes/${name}/${profileId}.glb`,
      room: scene.room,
      instances: scene.instances.map((inst) => ({ id: inst.id, position: inst.position, yaw: inst.yaw })),
      size,
    });
    const stats = `${report.dimensions.meters.map((v) => v.toFixed(2)).join(' × ')} m · ${report.instanceCount} instances of ${report.items.length} assets · ${report.triangles.total.toLocaleString('en-US')} tris · ${report.meshCount} meshes · ${report.counts.error} err / ${report.counts.warning} warn · ${report.profile.label}`;
    const sheetImage = await call('sheet', {
      tiles: rendered.tiles.map((t) => ({ image: t.image, label: t.label })),
      columns: 3,
      tileSize: size,
      title: `Scene — ${scene.title}`,
      lines: [scene.prompt ? `Prompt: ${scene.prompt}` : '', stats].filter(Boolean),
    });
    return { tiles: rendered.tiles, sheet: sheetImage };
  });
  const views = {};
  for (const tile of tiles) views[tile.key] = rel(writeDataUrl(path.join(dir, `${tile.key}.png`), tile.image));
  const sheetFile = writeDataUrl(path.join(dir, 'sheet.png'), sheet);
  return { name, profile: profileId, report, sheet: rel(sheetFile), dir: rel(dir), views };
}
