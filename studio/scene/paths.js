// Paths used by scenes (rooms assembled from library assets).
// Scene code lives outside studio/kit, studio/core and studio/profiles on purpose: those
// folders are part of every asset's build hash, so scene work never invalidates asset previews.

import path from 'node:path';
import { paths, ROOT } from '../core/paths.js';

// STUDIO_SCENES_DIR lets tests run against a throwaway folder.
const SCENES = process.env.STUDIO_SCENES_DIR ? path.resolve(process.env.STUDIO_SCENES_DIR) : path.join(ROOT, 'scenes');

export const scenePaths = {
  scenes: SCENES,
  state: path.join(paths.state, 'scenes'),
  thumbs: path.join(paths.state, 'thumbs'),
  code: path.join(ROOT, 'studio', 'scene'),
};

export function sceneDir(name) {
  return path.join(scenePaths.scenes, name);
}

export function sceneFile(name) {
  return path.join(scenePaths.scenes, name, 'scene.json');
}

export function sceneStateDir(name) {
  return path.join(scenePaths.state, name);
}

export function sceneGlb(name, profileId) {
  return path.join(sceneStateDir(name), `${profileId}.glb`);
}

export function sceneReport(name, profileId) {
  return path.join(sceneStateDir(name), `${profileId}.report.json`);
}

export function shellGlb(name, profileId) {
  return path.join(sceneStateDir(name), `shell.${profileId}.glb`);
}

export function shellInfo(name, profileId) {
  return path.join(sceneStateDir(name), `shell.${profileId}.json`);
}

export function sceneHistoryDir(name) {
  return path.join(sceneStateDir(name), 'history');
}

export function sceneShotsDir(name) {
  return path.join(paths.shots, `scene-${name}`);
}

export function sceneExportPaths(name, profileId) {
  const base = path.join(paths.exports, profileId, 'scenes', name);
  return { glb: `${base}.glb`, json: `${base}.report.json`, md: `${base}.report.md`, layout: `${base}.layout.json` };
}
