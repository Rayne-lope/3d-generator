// scenes/<name>/scene.json: read, validate, normalize and write.
// The file is plain data (a room spec and a list of placed assets), so a coding agent, the
// browser composer and the CLI all edit the same thing.

import fs from 'node:fs';
import path from 'node:path';
import { readJson, sha256, writeJson } from '../core/fsutil.js';
import { isValidSlug } from '../core/targets.js';
import { WALLS, normalizeYaw } from '../viewport/snap.js';
import { scenePaths, sceneDir, sceneFile } from './paths.js';

export class SceneError extends Error {
  constructor(message, status = 400, field = null, code = null) {
    super(message);
    this.status = status;
    this.field = field;
    this.code = code || ({ 400: 'invalid_input', 404: 'not_found', 409: 'conflict' }[status] || 'operation_failed');
  }
}

export const SCENE_VERSION = 1;
/** Flat finishes for the room shell (kinds of k.mat.physical that make sense on a wall or floor). */
export const FINISH_KINDS = ['plaster', 'concrete', 'brick', 'stone', 'wood', 'painted-wood', 'varnished-wood', 'ceramic', 'plastic', 'fabric', 'rubber'];
export const DEFAULT_FINISHES = {
  wall: { kind: 'plaster', color: '#e6e2d8' },
  floor: { kind: 'concrete', color: '#b9b5ad' },
  ceiling: { kind: 'plaster', color: '#f2f0ea' },
};
export const ROOM_LIMITS = { width: [1, 100], depth: [1, 100], height: [2, 20], wallThickness: [0.05, 1] };
export const MAX_INSTANCES = 2000;
const OPENING_MARGIN = 0.05;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const LOOK_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const HEX_RE = /^#[0-9a-f]{6}$/;

const round = (v, digits) => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

function number(value, field, [min, max]) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new SceneError(`${field} must be a number`, 400, field);
  if (value < min || value > max) throw new SceneError(`${field} must be between ${min} and ${max}`, 400, field);
  return value;
}

function text(value, field, max, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new SceneError(`${field} must be text`, 400, field);
  if (value.length > max) throw new SceneError(`${field} is longer than ${max} characters`, 400, field);
  return value;
}

export function assertSceneName(name) {
  if (typeof name !== 'string' || !isValidSlug(name)) throw new SceneError('invalid scene name (lowercase letters, digits and single dashes)', 400, 'name');
}

/** Length of the interior span an opening on this wall may use. */
export function wallSpan(room, wall) {
  return wall === 'front' || wall === 'back' ? room.width : room.depth;
}

function normalizeFinish(raw, field, fallback) {
  if (raw === undefined || raw === null) return { ...fallback };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new SceneError(`${field} must be { kind, color }`, 400, field);
  const kind = raw.kind ?? fallback.kind;
  if (!FINISH_KINDS.includes(kind)) throw new SceneError(`${field}.kind must be one of ${FINISH_KINDS.join(', ')}`, 400, `${field}.kind`);
  const color = String(raw.color ?? fallback.color).toLowerCase();
  if (!HEX_RE.test(color)) throw new SceneError(`${field}.color must be a six-digit hex color`, 400, `${field}.color`);
  return { kind, color };
}

function normalizeRoom(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new SceneError('room must be an object or null', 400, 'room');
  const room = {
    width: round(number(raw.width, 'room.width', ROOM_LIMITS.width), 3),
    depth: round(number(raw.depth, 'room.depth', ROOM_LIMITS.depth), 3),
    height: round(number(raw.height ?? 3, 'room.height', ROOM_LIMITS.height), 3),
    wallThickness: round(number(raw.wallThickness ?? 0.2, 'room.wallThickness', ROOM_LIMITS.wallThickness), 3),
    ceiling: raw.ceiling === undefined ? true : raw.ceiling,
    openings: [],
    finishes: {},
  };
  if (typeof room.ceiling !== 'boolean') throw new SceneError('room.ceiling must be true or false', 400, 'room.ceiling');
  const finishes = raw.finishes ?? {};
  if (typeof finishes !== 'object' || Array.isArray(finishes)) throw new SceneError('room.finishes must be an object', 400, 'room.finishes');
  for (const zone of ['wall', 'floor', 'ceiling']) room.finishes[zone] = normalizeFinish(finishes[zone], `room.finishes.${zone}`, DEFAULT_FINISHES[zone]);
  const openings = raw.openings ?? [];
  if (!Array.isArray(openings) || openings.length > 64) throw new SceneError('room.openings must be a list (max 64)', 400, 'room.openings');
  openings.forEach((o, i) => {
    const field = `room.openings[${i}]`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new SceneError(`${field} must be an object`, 400, field);
    if (!WALLS.includes(o.wall)) throw new SceneError(`${field}.wall must be one of ${WALLS.join(', ')}`, 400, `${field}.wall`);
    const shape = o.shape ?? 'rect';
    if (shape !== 'rect' && shape !== 'arch') throw new SceneError(`${field}.shape must be rect or arch`, 400, `${field}.shape`);
    const opening = {
      wall: o.wall,
      offset: round(number(o.offset ?? 0, `${field}.offset`, [-50, 50]), 3),
      y: round(number(o.y ?? 0, `${field}.y`, [0, 20]), 3),
      w: round(number(o.w, `${field}.w`, [0.1, 50]), 3),
      h: round(number(o.h, `${field}.h`, [0.1, 20]), 3),
      shape,
    };
    const half = wallSpan(room, opening.wall) / 2;
    if (opening.offset - opening.w / 2 < -half + OPENING_MARGIN || opening.offset + opening.w / 2 > half - OPENING_MARGIN) {
      throw new SceneError(`${field} does not fit on the ${opening.wall} wall (keep ${OPENING_MARGIN * 100} cm from the corners)`, 400, field);
    }
    if (opening.y + opening.h > room.height - OPENING_MARGIN) throw new SceneError(`${field} is taller than the wall (keep ${OPENING_MARGIN * 100} cm below the ceiling)`, 400, field);
    room.openings.push(opening);
  });
  for (const wall of WALLS) {
    const list = room.openings.filter((o) => o.wall === wall).sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const sideBySide = a.offset + a.w / 2 + OPENING_MARGIN > b.offset - b.w / 2;
      const stacked = a.y + a.h < b.y || b.y + b.h < a.y;
      if (sideBySide && !stacked) throw new SceneError(`two openings on the ${wall} wall overlap or are closer than ${OPENING_MARGIN * 100} cm`, 400, 'room.openings');
    }
  }
  return room;
}

function normalizeInstance(raw, index, seen) {
  const field = `instances[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SceneError(`${field} must be an object`, 400, field);
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) throw new SceneError(`${field}.id must be lowercase letters, digits or dashes`, 400, `${field}.id`);
  if (seen.has(raw.id)) throw new SceneError(`instance id '${raw.id}' is used twice`, 400, `${field}.id`, 'duplicate_id');
  seen.add(raw.id);
  if (typeof raw.asset !== 'string' || !isValidSlug(raw.asset)) throw new SceneError(`${field}.asset must be an asset slug`, 400, `${field}.asset`);
  const look = (value, key) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !LOOK_RE.test(value)) throw new SceneError(`${field}.${key} is not a valid ${key} name`, 400, `${field}.${key}`);
    return value;
  };
  const position = raw.position ?? [0, 0, 0];
  if (!Array.isArray(position) || position.length !== 3) throw new SceneError(`${field}.position must be [x, y, z] in meters`, 400, `${field}.position`);
  const instance = {
    id: raw.id,
    asset: raw.asset,
    variant: look(raw.variant, 'variant'),
    skin: look(raw.skin, 'skin'),
    position: position.map((v, i) => round(number(v, `${field}.position[${i}]`, [-1000, 1000]), 4)),
    yaw: round(normalizeYaw(number(raw.yaw ?? 0, `${field}.yaw`, [-36000, 36000])), 2),
  };
  if (instance.yaw === 360) instance.yaw = 0;
  if (raw.locked !== undefined && typeof raw.locked !== 'boolean') throw new SceneError(`${field}.locked must be true or false`, 400, `${field}.locked`);
  if (raw.locked) instance.locked = true;
  const label = text(raw.name, `${field}.name`, 80, '');
  if (label) instance.name = label;
  // Instances with the same group move as one unit in the composer and export under one node.
  if (raw.group !== undefined && raw.group !== null && raw.group !== '') {
    if (typeof raw.group !== 'string' || !ID_RE.test(raw.group)) throw new SceneError(`${field}.group must be lowercase letters, digits or dashes`, 400, `${field}.group`);
    instance.group = raw.group;
  }
  return instance;
}

/** Validate and return the canonical form (fixed key order, rounded numbers). Throws SceneError. */
export function normalizeScene(raw, { name = 'scene' } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SceneError('scene must be an object');
  if (raw.version !== SCENE_VERSION) throw new SceneError(`scene.version must be ${SCENE_VERSION}`, 400, 'version');
  const instances = raw.instances ?? [];
  if (!Array.isArray(instances)) throw new SceneError('instances must be a list', 400, 'instances');
  if (instances.length > MAX_INSTANCES) throw new SceneError(`a scene holds at most ${MAX_INSTANCES} instances`, 400, 'instances');
  const seen = new Set();
  const list = instances.map((inst, i) => normalizeInstance(inst, i, seen));
  const clash = list.find((inst) => inst.group && seen.has(inst.group));
  if (clash) throw new SceneError(`group '${clash.group}' has the same name as an instance: pick another group name`, 400, 'instances');
  return {
    version: SCENE_VERSION,
    title: text(raw.title, 'title', 120, name) || name,
    prompt: text(raw.prompt, 'prompt', 4000),
    interpretation: text(raw.interpretation, 'interpretation', 4000),
    room: normalizeRoom(raw.room),
    instances: list,
  };
}

export function listScenes() {
  if (!fs.existsSync(scenePaths.scenes)) return [];
  return fs.readdirSync(scenePaths.scenes, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isValidSlug(d.name) && fs.existsSync(path.join(scenePaths.scenes, d.name, 'scene.json')))
    .map((d) => d.name)
    .sort();
}

export function sceneExists(name) {
  return typeof name === 'string' && isValidSlug(name) && fs.existsSync(sceneFile(name));
}

/** Content hash of scene.json: the token for conflict detection (browser vs agent edits). */
export function sceneRevision(name) {
  assertSceneName(name);
  const file = sceneFile(name);
  if (!fs.existsSync(file)) throw new SceneError(`scene '${name}' not found (scenes/${name}/scene.json)`, 404);
  return sha256(fs.readFileSync(file));
}

export function readScene(name) {
  const revision = sceneRevision(name);
  let raw;
  try {
    raw = readJson(sceneFile(name));
  } catch (err) {
    throw new SceneError(`scenes/${name}/scene.json is not valid JSON: ${err.message}`);
  }
  let scene;
  try {
    scene = normalizeScene(raw, { name });
  } catch (err) {
    if (err instanceof SceneError) throw new SceneError(`scenes/${name}/scene.json: ${err.message}`, err.status, err.field, err.code);
    throw err;
  }
  return { name, scene, revision };
}

/**
 * Write a scene. With expectedRevision, refuses when the file changed since it was read
 * (another editor or an agent saved in between).
 */
export function writeScene(name, raw, { expectedRevision = null } = {}) {
  assertSceneName(name);
  const scene = normalizeScene(raw, { name });
  if (expectedRevision !== null) {
    if (!fs.existsSync(sceneFile(name))) throw new SceneError(`scene '${name}' not found`, 404);
    if (sceneRevision(name) !== expectedRevision) throw new SceneError('scene changed on disk', 409);
  }
  writeJson(sceneFile(name), scene);
  return { name, scene, revision: sceneRevision(name) };
}

export function createScene(name, { title = null, prompt = '', interpretation = '', room = undefined } = {}) {
  assertSceneName(name);
  if (fs.existsSync(sceneDir(name))) throw new SceneError(`scene '${name}' already exists`, 409, 'name', 'exists');
  return writeScene(name, {
    version: SCENE_VERSION,
    title: title || name,
    prompt,
    interpretation,
    room: room === undefined ? { width: 6, depth: 4, height: 3 } : room,
    instances: [],
  });
}

/** 'WxDxH' (meters) → room spec; 'none' → no shell. */
export function parseRoomSize(spec) {
  if (spec === 'none') return null;
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/.exec(String(spec));
  if (!m) throw new SceneError(`room size '${spec}' must look like 6x4x3 (width x depth x height, meters) or 'none'`, 400, 'room');
  return { width: Number(m[1]), depth: Number(m[2]), height: m[3] ? Number(m[3]) : 3 };
}
