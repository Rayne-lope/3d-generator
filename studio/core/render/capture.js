// Headless rendering with Playwright + Chromium. WebGL is forced onto SwiftShader so that
// renders are deterministic across machines (baselines and parity checks stay comparable).

import fs from 'node:fs';
import { startStaticServer } from '../../server/server.js';

const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'];

async function launch() {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error("Playwright is not installed. Run 'npm install' in the repo.");
  }
  const options = { args: CHROMIUM_ARGS };
  if (process.env.STUDIO_CHROMIUM) options.executablePath = process.env.STUDIO_CHROMIUM;
  try {
    return await playwright.chromium.launch(options);
  } catch (err) {
    const fallback = ['/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
    if (fallback && !options.executablePath) return playwright.chromium.launch({ ...options, executablePath: fallback });
    throw new Error(`Could not start Chromium for headless renders: ${err.message.split('\n')[0]}\nRun 'npx playwright install chromium' (or set STUDIO_CHROMIUM to a Chrome/Chromium binary).`);
  }
}

/**
 * Run fn(api) with a capture page open. api methods mirror window.studioCapture.
 * @template T
 * @param {(api: any) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withCapture(fn) {
  const server = await startStaticServer();
  const browser = await launch();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto(`${server.url}capture`);
    await page.waitForFunction(() => window.studioReady === true, null, { timeout: 30000 });
    const call = (method) => async (opts) => {
      try {
        return await page.evaluate(([m, o]) => window.studioCapture[m](o), [method, opts]);
      } catch (err) {
        const extra = errors.length ? `\n${errors.slice(-3).join('\n')}` : '';
        throw new Error(`capture.${method} failed: ${err.message.split('\n')[0]}${extra}`);
      }
    };
    const api = {
      url: server.url,
      renderGLB: call('renderGLB'),
      boxGLB: call('boxGLB'),
      renderSource: call('renderSource'),
      sheet: call('sheet'),
      lineup: call('lineup'),
      webglInfo: call('webglInfo'),
      renderParts: call('renderParts'),
      blueprint: call('blueprint'),
      referenceOverlay: call('referenceOverlay'),
      errors,
    };
    return await fn(api);
  } finally {
    await browser.close();
    await server.close();
  }
}
