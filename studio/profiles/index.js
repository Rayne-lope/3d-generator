// Engine profile loader.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

export function listProfiles() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
}

const cache = new Map();

export function loadProfile(id) {
  if (cache.has(id)) return cache.get(id);
  const file = path.join(DIR, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`unknown profile '${id}' (available: ${listProfiles().join(', ')})`);
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  cache.set(id, profile);
  return profile;
}

/** Expand 'all' / comma lists into profile ids. */
export function resolveProfiles(spec, fallback = 'generic') {
  if (!spec) return [fallback];
  if (spec === 'all') return listProfiles();
  return String(spec).split(',').map((s) => s.trim()).filter(Boolean).map((id) => loadProfile(id).id);
}
