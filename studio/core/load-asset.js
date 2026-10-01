// Import an asset module (each build process imports a module once).

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assetFile } from './paths.js';

const cache = new Map();

export async function loadAssetDef(slug) {
  if (cache.has(slug)) return cache.get(slug);
  const file = assetFile(slug);
  if (!fs.existsSync(file)) throw new Error(`asset '${slug}' not found (assets/${slug}/asset.js)`);
  const mod = await import(pathToFileURL(file).href);
  const def = mod.default;
  if (!def || !def.__studioAsset) {
    throw new Error(`assets/${slug}/asset.js must \`export default defineAsset({...})\``);
  }
  cache.set(slug, def);
  return def;
}
