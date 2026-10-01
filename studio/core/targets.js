// Resolve CLI targets into build items: '<slug>', 'set:<name>' or --all.

import fs from 'node:fs';
import path from 'node:path';
import { paths, assetFile } from './paths.js';
import { readJson } from './fsutil.js';
import { loadAssetDef } from './load-asset.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidSlug(slug) {
  return SLUG_RE.test(slug) && !slug.includes('--');
}

export function listAssets() {
  if (!fs.existsSync(paths.assets)) return [];
  return fs.readdirSync(paths.assets, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(paths.assets, d.name, 'asset.js')))
    .map((d) => d.name)
    .sort();
}

export function listSets() {
  if (!fs.existsSync(paths.sets)) return [];
  return fs.readdirSync(paths.sets, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(paths.sets, d.name, 'set.json')))
    .map((d) => d.name)
    .sort();
}

export function loadSet(name) {
  const file = path.join(paths.sets, name, 'set.json');
  if (!fs.existsSync(file)) throw new Error(`unknown set '${name}' (sets: ${listSets().join(', ') || 'none'})`);
  const set = readJson(file);
  return { name, ...set, members: set.members || [] };
}

/** Which set (if any) an asset belongs to. */
export function setOfAsset(slug) {
  for (const name of listSets()) {
    if (loadSet(name).members.includes(slug)) return name;
  }
  return null;
}

/**
 * @param {string[]} specs positional targets
 * @param {{all?: boolean, variant?: string, variants?: 'all'|'base'}} opts
 * @returns {Promise<{slug: string, variant: string|null}[]>}
 */
export async function resolveTargets(specs, { all = false, variant = null, variants = 'all' } = {}) {
  let slugs = [];
  if (all) slugs = listAssets();
  for (const spec of specs) {
    if (spec.startsWith('set:')) slugs.push(...loadSet(spec.slice(4)).members);
    else slugs.push(spec);
  }
  slugs = [...new Set(slugs)];
  if (!slugs.length) throw new Error('no target: pass an asset slug, set:<name> or --all');
  const items = [];
  for (const slug of slugs) {
    if (!fs.existsSync(assetFile(slug))) throw new Error(`unknown asset '${slug}' (missing assets/${slug}/asset.js). Assets: ${listAssets().join(', ') || 'none'}`);
    if (variant) {
      if (variant === 'base') items.push({ slug, variant: null });
      else items.push({ slug, variant });
      continue;
    }
    items.push({ slug, variant: null });
    if (variants === 'all') {
      const def = await loadAssetDef(slug);
      for (const v of Object.keys(def.variants)) items.push({ slug, variant: v });
    }
  }
  return items;
}
