// Materials: only glTF PBR metallic-roughness (THREE.MeshStandardMaterial) is allowed,
// because that is what survives export to every engine. Everything else throws early.

import * as THREE from 'three';
import { toColor } from './color.js';

/**
 * Physically plausible starting values per material class. These are not a style:
 * pick the color from the prompt and override anything you need.
 */
export const PHYSICAL = {
  wood: { color: '#8a5a36', roughness: 0.78, metalness: 0 },
  'painted-wood': { color: '#b8443a', roughness: 0.6, metalness: 0 },
  'varnished-wood': { color: '#7a4a2a', roughness: 0.42, metalness: 0 },
  stone: { color: '#8c8a84', roughness: 0.88, metalness: 0 },
  concrete: { color: '#9a9690', roughness: 0.92, metalness: 0 },
  brick: { color: '#9a4a36', roughness: 0.86, metalness: 0 },
  plaster: { color: '#d8d0c2', roughness: 0.9, metalness: 0 },
  plastic: { color: '#d0d0d0', roughness: 0.45, metalness: 0 },
  'hard-plastic': { color: '#3c3f45', roughness: 0.35, metalness: 0 },
  rubber: { color: '#2a2a2a', roughness: 0.92, metalness: 0 },
  fabric: { color: '#7a6a5a', roughness: 0.95, metalness: 0 },
  leather: { color: '#6b3f24', roughness: 0.6, metalness: 0 },
  ceramic: { color: '#e8e2d6', roughness: 0.25, metalness: 0 },
  clay: { color: '#b0623e', roughness: 0.85, metalness: 0 },
  paper: { color: '#e9e2cf', roughness: 0.9, metalness: 0 },
  wax: { color: '#efe3c4', roughness: 0.55, metalness: 0 },
  foliage: { color: '#4f7a34', roughness: 0.8, metalness: 0 },
  bark: { color: '#5a4030', roughness: 0.92, metalness: 0 },
  crystal: { color: '#8f6bd8', roughness: 0.15, metalness: 0 },
  ice: { color: '#cfe8f2', roughness: 0.1, metalness: 0 },
  rust: { color: '#7b3a1a', roughness: 0.92, metalness: 0 },
  iron: { color: '#8f9396', roughness: 0.55, metalness: 1 },
  'dark-iron': { color: '#4a4c4f', roughness: 0.6, metalness: 1 },
  steel: { color: '#b4b8bb', roughness: 0.35, metalness: 1 },
  aluminium: { color: '#d4d6d8', roughness: 0.4, metalness: 1 },
  brass: { color: '#d8b56a', roughness: 0.35, metalness: 1 },
  bronze: { color: '#b07a45', roughness: 0.45, metalness: 1 },
  copper: { color: '#d48a63', roughness: 0.35, metalness: 1 },
  gold: { color: '#f0c45c', roughness: 0.28, metalness: 1 },
  silver: { color: '#dcdcdc', roughness: 0.25, metalness: 1 },
  glow: { color: '#202020', roughness: 0.6, metalness: 0, emissive: '#ffd27a', emissiveIntensity: 1 },
};

const ALPHA_MODES = new Set(['opaque', 'mask', 'blend']);

function assertKitTexture(tex, expectedSpace, slot) {
  if (!tex) return;
  const info = tex.userData?.studio;
  if (!info?.kitTexture) {
    throw new Error(`k.mat.pbr: '${slot}' must be a kit texture (painter.toTexture()). Other texture sources are not exportable.`);
  }
  if (info.space !== expectedSpace) {
    throw new Error(`k.mat.pbr: '${slot}' must be a '${expectedSpace}' texture (got '${info.space}' from '${info.name}'). Color maps are sRGB; normal/ORM maps are linear.`);
  }
}

function toTex(input) {
  if (!input) return null;
  if (input.isTexture) return input;
  if (typeof input.toTexture === 'function') return input.toTexture();
  throw new Error('k.mat.pbr: texture inputs must be a painter (k.tex.create) or painter.toTexture()');
}

/**
 * Standard glTF PBR material.
 * @param {object} opts
 * @param {string} [opts.name]
 * @param {*} [opts.color] base color (sRGB authoring color)
 * @param {number} [opts.roughness] 0..1
 * @param {number} [opts.metalness] 0 or 1 for real materials
 * @param {*} [opts.emissive] emissive color (sRGB)
 * @param {number} [opts.emissiveIntensity] >1 needs KHR_materials_emissive_strength (not on Roblox)
 * @param {*} [opts.map] base color painter/texture (sRGB)
 * @param {*} [opts.normalMap] normal painter/texture (linear, OpenGL convention)
 * @param {number} [opts.normalScale]
 * @param {*} [opts.ormMap] packed occlusion/roughness/metalness painter/texture (linear)
 * @param {*} [opts.emissiveMap] emissive painter/texture (sRGB)
 * @param {'opaque'|'mask'|'blend'} [opts.alpha]
 * @param {number} [opts.alphaCutoff]
 * @param {number} [opts.opacity]
 */
export function pbr(opts = {}) {
  const known = new Set(['name', 'color', 'roughness', 'metalness', 'emissive', 'emissiveIntensity', 'map', 'normalMap', 'normalScale', 'ormMap', 'aoIntensity', 'emissiveMap', 'alpha', 'alphaCutoff', 'opacity', 'doubleSided', 'side']);
  for (const key of Object.keys(opts)) {
    if (!known.has(key)) throw new Error(`k.mat.pbr: unknown option '${key}'. Allowed: ${[...known].join(', ')}`);
  }
  const {
    name = 'material', color = '#cccccc', roughness = 0.6, metalness = 0, emissive = null, emissiveIntensity = 1,
    normalScale = 1, aoIntensity = 1, alpha = 'opaque', alphaCutoff = 0.5, opacity = 1,
  } = opts;
  if (opts.doubleSided || opts.side !== undefined) {
    throw new Error('k.mat.pbr: double-sided materials are not allowed (engines disagree on back faces). Model real thickness, or add a second face with flipped normals.');
  }
  if (!(roughness >= 0 && roughness <= 1)) throw new Error(`k.mat.pbr(${name}): roughness must be 0..1`);
  if (!(metalness >= 0 && metalness <= 1)) throw new Error(`k.mat.pbr(${name}): metalness must be 0..1`);
  if (!ALPHA_MODES.has(alpha)) throw new Error(`k.mat.pbr(${name}): alpha must be 'opaque', 'mask' or 'blend'`);
  if (!(emissiveIntensity >= 0)) throw new Error(`k.mat.pbr(${name}): emissiveIntensity must be >= 0`);

  const material = new THREE.MeshStandardMaterial({ name, color: toColor(color), roughness, metalness });
  material.side = THREE.FrontSide;

  const map = toTex(opts.map);
  assertKitTexture(map, 'srgb', 'map');
  if (map) material.map = map;

  const normalMap = toTex(opts.normalMap);
  assertKitTexture(normalMap, 'linear', 'normalMap');
  if (normalMap) {
    material.normalMap = normalMap;
    // Matches GLTFLoader for meshes rendered without explicit tangents (derivative tangents).
    // The exported GLB carries MikkTSpace tangents and the plain positive scale.
    material.normalScale.set(normalScale, -normalScale);
  }

  const orm = toTex(opts.ormMap);
  assertKitTexture(orm, 'linear', 'ormMap');
  if (orm) {
    material.roughnessMap = orm;
    material.metalnessMap = orm;
    if (orm.userData.studio.hasAO) {
      material.aoMap = orm;
      material.aoMapIntensity = aoIntensity;
    }
  }

  if (emissive) {
    material.emissive = toColor(emissive);
    material.emissiveIntensity = emissiveIntensity;
  }
  const emissiveMap = toTex(opts.emissiveMap);
  assertKitTexture(emissiveMap, 'srgb', 'emissiveMap');
  if (emissiveMap) {
    material.emissiveMap = emissiveMap;
    if (!emissive) material.emissive = new THREE.Color(1, 1, 1);
    material.emissiveIntensity = emissiveIntensity;
  }

  if (alpha === 'mask') {
    material.alphaTest = alphaCutoff;
    material.transparent = false;
  } else if (alpha === 'blend') {
    material.transparent = true;
    material.depthWrite = false;
    material.opacity = opacity;
  }
  if (alpha !== 'blend' && opacity !== 1) {
    throw new Error(`k.mat.pbr(${name}): opacity < 1 requires alpha: 'blend'`);
  }

  material.userData.studio = { kitMaterial: true, alpha, alphaCutoff };
  return material;
}

/** PBR material from a physical preset, e.g. k.mat.physical('iron', { color: '#55595c' }). */
export function physical(kind, overrides = {}) {
  const preset = PHYSICAL[kind];
  if (!preset) throw new Error(`k.mat.physical: unknown kind '${kind}'. Known: ${Object.keys(PHYSICAL).join(', ')}`);
  return pbr({ name: overrides.name || kind, ...preset, ...overrides });
}
