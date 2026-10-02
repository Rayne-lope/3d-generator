// Resolve CLI targets into build items: '<slug>', 'set:<name>' or --all.

import fs from 'node:fs';
import path from 'node:path';
import { paths, assetFile, parseItemId } from './paths.js';
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
 * Targets: '<slug>', '<slug>--<variant>', '<slug>@<skin>', 'set:<name>' or --all.
 * Skins are left out unless asked for: skin 'all' adds every skin of every item (after the
 * plain item), a skin name keeps only that skin ('default' = the base look).
 * @param {string[]} specs positional targets
 * @param {{all?: boolean, variant?: string, variants?: 'all'|'base', skin?: string|null}} opts
 * @returns {Promise<{slug: string, variant: string|null, skin: string|null}[]>}
 */
export async function resolveTargets(specs, { all = false, variant = null, variants = 'all', skin = null } = {}) {
  const wanted = [];
  if (all) for (const slug of listAssets()) wanted.push({ slug });
  for (const spec of specs) {
    if (spec.startsWith('set:')) {
      for (const slug of loadSet(spec.slice(4)).members) wanted.push({ slug });
      continue;
    }
    const parsed = parseItemId(spec);
    // An item id ('slug--variant', 'slug@skin') names exactly that item.
    if (parsed && (parsed.variant || parsed.skin)) wanted.push({ slug: parsed.slug, variant: parsed.variant, skin: parsed.skin ?? undefined });
    else wanted.push({ slug: spec });
  }
  if (!wanted.length) throw new Error('no target: pass an asset slug, set:<name> or --all');
  const items = [];
  const seen = new Set();
  const push = (it) => {
    const key = `${it.slug}|${it.variant || ''}|${it.skin || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(it);
  };
  for (const w of wanted) {
    const { slug } = w;
    if (!fs.existsSync(assetFile(slug))) throw new Error(`unknown asset '${slug}' (missing assets/${slug}/asset.js). Assets: ${listAssets().join(', ') || 'none'}`);
    // Import the module only when its variants/skins are needed, so a broken asset still
    // reaches the build step and gets a proper per-item error.
    let def = null;
    const getDef = async () => (def ??= await loadAssetDef(slug));
    let vlist;
    if (w.variant !== undefined) vlist = [w.variant];
    else if (variant) vlist = [variant === 'base' ? null : variant];
    else vlist = variants === 'all' ? [null, ...Object.keys((await getDef()).variants)] : [null];
    const skinOf = w.skin !== undefined ? w.skin : skin;
    let slist = [null];
    if (skinOf && skinOf !== 'default' && skinOf !== 'base') {
      const skinNames = Object.keys((await getDef()).skins || {});
      if (skinOf === 'all') slist = [null, ...skinNames];
      else if (skinNames.includes(skinOf)) slist = [skinOf];
      else throw new Error(`unknown skin '${skinOf}' of ${slug} (skins: ${skinNames.join(', ') || 'none'})`);
    }
    for (const v of vlist) for (const s of slist) push({ slug, variant: v, skin: s });
  }
  return items;
}
