// Scene checkpoints: numbered copies of scene.json in .studio/scenes/<name>/history/.
// A scene is one small file, so a version is just that file plus a note.

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, readJson, writeFileAtomic, writeJson } from '../core/fsutil.js';
import { loadConfig } from '../core/config.js';
import { normalizeScene, readScene, sceneRevision, SceneError } from './schema.js';
import { sceneFile, sceneHistoryDir } from './paths.js';

function indexFile(name) {
  return path.join(sceneHistoryDir(name), 'index.json');
}

function readIndex(name) {
  return readJson(indexFile(name), { versions: [], head: null });
}

export function listSceneVersions(name) {
  return readIndex(name).versions;
}

/** Whether the working copy equals a saved version. */
export function sceneWorkingState(name) {
  const { versions, head } = readIndex(name);
  const revision = sceneRevision(name);
  const current = [...versions].reverse().find((v) => v.revision === revision) || null;
  return { head, current: current?.id || null, dirty: !current, revision };
}

function nextId(name, versions) {
  const dir = sceneHistoryDir(name);
  const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => /^v\d+$/.test(d)) : [];
  const n = [...versions.map((v) => v.id), ...onDisk].reduce((m, id) => Math.max(m, Number(id.slice(1))), 0) + 1;
  return `v${String(n).padStart(3, '0')}`;
}

/** Save the working copy as a version. Skips when nothing changed since the head (unless force). */
export function saveSceneVersion(name, { note = '', auto = false, force = false, keep = loadConfig().history.keep } = {}) {
  const { scene, revision } = readScene(name);
  const index = readIndex(name);
  const headV = index.versions.find((v) => v.id === index.head) || null;
  if (headV && headV.revision === revision && !force) return { skipped: true, version: headV, reason: `no changes since ${headV.id}` };
  const id = nextId(name, index.versions);
  const dir = ensureDir(path.join(sceneHistoryDir(name), id));
  fs.copyFileSync(sceneFile(name), path.join(dir, 'scene.json'));
  const version = {
    id, createdAt: new Date().toISOString(), note, auto: !!auto, parent: headV ? headV.id : null, revision,
    instances: scene.instances.length, room: scene.room ? [scene.room.width, scene.room.depth, scene.room.height] : null,
  };
  let versions = [...index.versions, version];
  // Keep the newest `keep` versions (auto-saves go first when trimming).
  if (keep > 0 && versions.length > keep) {
    const drop = versions.slice(0, versions.length - keep).map((v) => v.id);
    for (const old of drop) fs.rmSync(path.join(sceneHistoryDir(name), old), { recursive: true, force: true });
    versions = versions.filter((v) => !drop.includes(v.id));
  }
  writeJson(indexFile(name), { versions, head: id });
  return { skipped: false, version };
}

/** Restore a version into the working copy. Unsaved work is auto-saved first. */
export function restoreSceneVersion(name, id) {
  const index = readIndex(name);
  const version = index.versions.find((v) => v.id === id);
  const file = path.join(sceneHistoryDir(name), id, 'scene.json');
  if (!version || !fs.existsSync(file)) throw new SceneError(`version '${id}' of scene '${name}' not found`, 404);
  const state = sceneWorkingState(name);
  const autosaved = state.dirty ? saveSceneVersion(name, { note: `auto-save before restoring ${id}`, auto: true }) : null;
  // Copy the bytes back (after checking them), so the working copy has the version's revision again.
  normalizeScene(readJson(file), { name });
  writeFileAtomic(sceneFile(name), fs.readFileSync(file));
  const after = readIndex(name);
  writeJson(indexFile(name), { versions: after.versions, head: id });
  return { restored: id, revision: sceneRevision(name), autosaved: autosaved && !autosaved.skipped ? autosaved.version.id : null };
}
