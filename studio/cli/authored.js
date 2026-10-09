// Run a command against the *authored* sources of the golden assets: copies of their folders
// without editor.json. The visual editor autosaves working-copy overrides into that file; they
// are the user's edits, not a regression of the asset's default render, so the golden suite and
// the engine packs (which share one manifest) must not see them.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths, ROOT } from '../core/paths.js';
import { copyDir, readJson, removeDir } from '../core/fsutil.js';

export const EDITOR_SIDECAR = 'editor.json';

/**
 * Copy the folders of `slugs` from `assetsDir` into `outDir`, leaving editor.json out.
 * @returns {{copied: string[], ignoredOverrides: string[]}} ignoredOverrides: slugs that had a sidecar
 */
export function copyAuthoredSources(assetsDir, slugs, outDir) {
  const copied = [];
  const ignoredOverrides = [];
  for (const slug of slugs) {
    const from = path.join(assetsDir, slug);
    if (!fs.existsSync(path.join(from, 'asset.js'))) continue;
    const to = path.join(outDir, slug);
    copyDir(from, to);
    if (fs.existsSync(path.join(to, EDITOR_SIDECAR))) {
      fs.rmSync(path.join(to, EDITOR_SIDECAR));
      ignoredOverrides.push(slug);
    }
    copied.push(slug);
  }
  return { copied, ignoredOverrides };
}

export function goldenSlugs() {
  return readJson(path.join(paths.golden, 'golden.json')).items.map((item) => item.slug);
}

/** True inside the child process that already runs on authored copies. */
export function onAuthoredSources() {
  return process.env.STUDIO_AUTHORED === '1';
}

/**
 * Re-run `node studio <command> ...argv` on authored copies of the golden assets.
 * The copies live under the repo root (asset modules import ../../studio/kit and ../../sets),
 * builds go to their own state folder so the working copy's previews stay untouched.
 * @returns {Promise<number>} the exit code of the run
 */
export async function runOnAuthoredSources(command, argv, { quiet = false } = {}) {
  const dir = path.join(ROOT, `.tmp-golden-${process.pid}`);
  removeDir(dir);
  const cleanup = () => removeDir(dir);
  const onSignal = () => {
    cleanup();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const { ignoredOverrides } = copyAuthoredSources(paths.assets, goldenSlugs(), dir);
    if (ignoredOverrides.length && !quiet) {
      console.error(`golden assets are checked from their authored source; working-copy editor overrides ignored for: ${ignoredOverrides.join(', ')}`);
    }
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'studio', 'index.js'), command, ...argv], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, STUDIO_AUTHORED: '1', STUDIO_ASSETS_DIR: dir, STUDIO_STATE_DIR: path.join(paths.state, 'golden') },
      });
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanup();
  }
}
