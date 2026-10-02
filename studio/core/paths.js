// Repository paths used by the studio.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// STUDIO_ASSETS_DIR / STUDIO_SETS_DIR / STUDIO_STATE_DIR / STUDIO_EXPORTS_DIR let tests run against fixtures
// without touching the real project folders.
const STATE = process.env.STUDIO_STATE_DIR ? path.resolve(process.env.STUDIO_STATE_DIR) : path.join(ROOT, '.studio');

export const paths = {
  root: ROOT,
  assets: process.env.STUDIO_ASSETS_DIR ? path.resolve(process.env.STUDIO_ASSETS_DIR) : path.join(ROOT, 'assets'),
  sets: process.env.STUDIO_SETS_DIR ? path.resolve(process.env.STUDIO_SETS_DIR) : path.join(ROOT, 'sets'),
  rules: path.join(ROOT, 'rules'),
  exports: process.env.STUDIO_EXPORTS_DIR ? path.resolve(process.env.STUDIO_EXPORTS_DIR) : path.join(ROOT, 'exports'),
  golden: path.join(ROOT, 'golden'),
  engines: path.join(ROOT, 'engines'),
  profiles: path.join(ROOT, 'studio', 'profiles'),
  templates: path.join(ROOT, 'studio', 'templates'),
  viewport: path.join(ROOT, 'studio', 'viewport'),
  kit: path.join(ROOT, 'studio', 'kit'),
  state: STATE,
  preview: path.join(STATE, 'preview'),
  history: path.join(STATE, 'history'),
  shots: path.join(STATE, 'shots'),
  cache: path.join(STATE, 'cache'),
  tmp: path.join(STATE, 'tmp'),
  serverInfo: path.join(STATE, 'server.json'),
  metrics: path.join(STATE, 'metrics.json'),
  config: path.join(ROOT, 'studio.config.json'),
};

/** '<slug>', '<slug>--<variant>', '<slug>@<skin>' or '<slug>--<variant>@<skin>' */
export function itemId(slug, variant, skin = null) {
  return `${slug}${variant ? `--${variant}` : ''}${skin ? `@${skin}` : ''}`;
}

/** Inverse of itemId(). Slugs never contain '--' or '@'. */
export function parseItemId(id) {
  const m = /^([a-z0-9][a-z0-9-]*?)(?:--([a-z0-9][a-z0-9-]*?))?(?:@([a-z0-9][a-z0-9-]*))?$/.exec(id);
  if (!m) return null;
  return { slug: m[1], variant: m[2] || null, skin: m[3] || null };
}

export function assetDir(slug) {
  return path.join(paths.assets, slug);
}

export function assetFile(slug) {
  return path.join(paths.assets, slug, 'asset.js');
}

export function previewDir(slug, variant, skin = null) {
  return path.join(paths.preview, itemId(slug, variant, skin));
}

export function previewGlb(slug, variant, profile, skin = null) {
  return path.join(previewDir(slug, variant, skin), `${profile}.glb`);
}

export function previewReport(slug, variant, profile, skin = null) {
  return path.join(previewDir(slug, variant, skin), `${profile}.report.json`);
}

export function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}
