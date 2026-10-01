// Import an asset module. The import URL carries a hash of the file so a long-running process
// (tests, the history commands) picks up edits; each build process normally imports once.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assetFile } from './paths.js';

const cache = new Map();

export async function loadAssetDef(slug) {
  const file = assetFile(slug);
  if (!fs.existsSync(file)) throw new Error(`asset '${slug}' not found (assets/${slug}/asset.js)`);
  const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
  const key = `${file}#${hash}`;
  if (cache.has(key)) return cache.get(key);
  const mod = await import(`${pathToFileURL(file).href}?v=${hash}`);
  const def = mod.default;
  if (!def || !def.__studioAsset) {
    throw new Error(`assets/${slug}/asset.js must \`export default defineAsset({...})\``);
  }
  cache.set(key, def);
  return def;
}
