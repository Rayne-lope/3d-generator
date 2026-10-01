// The `k` namespace handed to every asset's build({ p, k, rng }).

import * as THREE from 'three';
import { asset, part, mesh, group, ring } from './scene.js';
import { pbr, physical, PHYSICAL } from './materials.js';
import { color } from './color.js';
import * as geo from './geo.js';
import * as shape from './shapes.js';
import * as op from './ops.js';
import * as uvTools from './uv.js';
import { createTexture, normalFromHeight, packORM } from './texture.js';
import { subtract, union, intersect } from './csg.js';
import { terrain } from './terrain.js';
import * as arch from './arch.js';
import { units } from './units.js';
import { createRng } from './rng.js';
import { createNoise } from './noise.js';

export const KIT_VERSION = '1.0.0';

export const k = {
  version: KIT_VERSION,
  THREE,
  // structure
  asset,
  part,
  mesh,
  group,
  ring,
  // materials & color
  mat: { pbr, physical, PHYSICAL },
  color,
  // geometry
  geo: { ...geo, terrain },
  shape,
  op: {
    translate: op.translate,
    rotate: op.rotate,
    scale: op.scale,
    transform: op.transform,
    mirror: op.mirror,
    clone: op.clone,
    merge: op.merge,
    center: op.center,
    sit: op.sit,
    bounds: op.bounds,
    flat: op.flat,
    crease: op.crease,
    smooth: op.smooth,
    reshade: op.reshade,
    taper: op.taper,
    bulge: op.bulge,
    twist: op.twist,
    bend: op.bend,
    displace: op.displace,
    noise: op.noise,
    jitter: op.jitter,
    dent: op.dent,
    keepFaces: op.keepFaces,
    flipWinding: op.flipWinding,
  },
  uv: {
    box: uvTools.box,
    planar: uvTools.planar,
    cylindrical: uvTools.cylindrical,
    scale: uvTools.scaleUV,
    offset: uvTools.offsetUV,
    rotate: uvTools.rotateUV,
    fit: uvTools.fit,
    unwrap: uvTools.unwrap,
    atlas: uvTools.atlas,
  },
  tex: { create: createTexture, normalFromHeight, orm: packORM },
  csg: { subtract, union, intersect },
  arch,
  units,
  rng: createRng,
  noise: createNoise,
  deg: (d) => (d * Math.PI) / 180,
  v3: (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z),
};
