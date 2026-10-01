// Version history (Phase 4). Filled in below; listVersions is used by the viewport API.

import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { readJson } from './fsutil.js';

export function historyDir(slug) {
  return path.join(paths.history, slug);
}

export function listVersions(slug) {
  const index = path.join(historyDir(slug), 'index.json');
  if (!fs.existsSync(index)) return [];
  return readJson(index, { versions: [] }).versions;
}
