// studio.config.json with defaults.

import fs from 'node:fs';
import { paths } from './paths.js';

export const DEFAULT_CONFIG = {
  defaultProfile: 'generic',
  server: { port: 5178, host: '127.0.0.1' },
  history: { keep: 20 },
  review: { views: ['front', 'right', 'back', 'top', 'iso', 'iso-wire'], size: 512 },
  parity: { pixelThreshold: 0.12, maxDiffRatio: 0.02 },
  golden: { regressionMaxDiffRatio: 0.01 },
};

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && typeof base[key] === 'object' ? deepMerge(base[key], value) : value;
  }
  return out;
}

let cached = null;

export function loadConfig() {
  if (cached) return cached;
  let user = {};
  if (fs.existsSync(paths.config)) {
    try {
      user = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
    } catch (err) {
      throw new Error(`studio.config.json is not valid JSON: ${err.message}`);
    }
  }
  cached = deepMerge(DEFAULT_CONFIG, user);
  return cached;
}
