// Test helpers: run the studio against fixture assets and a throwaway state directory.
// Call useFixtures() BEFORE importing studio modules (paths are resolved at import time).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function useFixtures({ assets = path.join(ROOT, 'tests', 'fixtures', 'assets') } = {}) {
  process.env.STUDIO_ASSETS_DIR = assets;
  process.env.STUDIO_SETS_DIR = path.join(ROOT, 'tests', 'fixtures', 'sets');
  process.env.STUDIO_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  process.env.STUDIO_EXPORTS_DIR = path.join(process.env.STUDIO_STATE_DIR, 'exports');
  process.env.STUDIO_NO_NOTIFY = '1';
  return process.env.STUDIO_STATE_DIR;
}

export function issueIds(report) {
  return report.issues.map((i) => i.id);
}

export function errors(report) {
  return report.issues.filter((i) => i.severity === 'error').map((i) => i.id);
}
