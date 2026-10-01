// Small filesystem helpers.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = undefined) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing file: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function writeFileAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** All files under dir (relative paths, sorted), skipping dot-dirs and node_modules. */
export function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d, prefix) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(d, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(dir, '');
  return out;
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Content hash of every file under the given directories (order independent of mtime). */
export function hashDirs(dirs, extra = '') {
  const h = crypto.createHash('sha256');
  h.update(extra);
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const rel of listFiles(dir)) {
      h.update(`${path.basename(dir)}/${rel}\n`);
      h.update(fs.readFileSync(path.join(dir, rel)));
    }
  }
  return h.digest('hex');
}

export function copyDir(src, dest) {
  ensureDir(dest);
  for (const rel of listFiles(src)) {
    const to = path.join(dest, rel);
    ensureDir(path.dirname(to));
    fs.copyFileSync(path.join(src, rel), to);
  }
}

export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
