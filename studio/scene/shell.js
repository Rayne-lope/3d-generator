// The room shell of a scene (floor, four walls, optional ceiling), generated from the room
// spec with the kit and sent through the same pipeline as any asset:
// kit scene → IR → profile transforms → GLB → inspect → validate.
// Every surface is its own node, so engines (and the composer) can hide or move them apart.

import fs from 'node:fs';
import { defineAsset, runAsset, KIT_VERSION } from '../kit/index.js';
import { sceneToIR } from '../core/ir/from-three.js';
import { irToGLB } from '../core/ir/to-gltf.js';
import { applyProfile } from '../core/transforms/index.js';
import { inspectGLB } from '../core/inspect.js';
import { validate } from '../core/validate/index.js';
import { loadProfile } from '../profiles/index.js';
import { paths } from '../core/paths.js';
import { hashDirs, readJson, sha256, writeFileAtomic, writeJson } from '../core/fsutil.js';
import path from 'node:path';
import { scenePaths, shellGlb, shellInfo } from './paths.js';

export const FLOOR_THICKNESS = 0.1;
export const CEILING_THICKNESS = 0.1;
export const SHELL_NODES = ['floor', 'wall-front', 'wall-back', 'wall-left', 'wall-right', 'ceiling'];

/** An asset definition for the shell of `room` (built in code, never written to assets/). */
export function shellDefinition(room, { title = 'Room' } = {}) {
  return defineAsset({
    meta: {
      title: `${title} (room shell)`,
      category: 'architecture',
      style: [],
      // The floor's top face is y = 0 and the room is centered: keep it exactly there.
      origin: 'none',
    },
    params: { room },
    build({ p, k }) {
      const { width: W, depth: D, height: H, wallThickness: T, finishes } = p.room;
      const asset = k.asset('room');
      const mat = (zone) => k.mat.physical(finishes[zone].kind, { name: `room_${zone}`, color: finishes[zone].color });
      const wallMat = mat('wall');
      const outerW = W + 2 * T;
      const outerD = D + 2 * T;

      const floor = k.part('floor', { separate: true, pivot: [0, 0, 0] });
      floor.add(k.mesh(k.geo.box(outerW, FLOOR_THICKNESS, outerD), mat('floor'), { name: 'floor', at: [0, -FLOOR_THICKNESS / 2, 0] }));
      asset.add(floor);

      const openingsOf = (wall) => p.room.openings.filter((o) => o.wall === wall).map((o) => ({ x: o.offset, y: o.y, w: o.w, h: o.h, shape: o.shape }));
      // Front/back walls run along X and cover the corners; left/right walls fit between them.
      for (const [wall, z] of [['front', D / 2 + T / 2], ['back', -D / 2 - T / 2]]) {
        const part = k.part(`wall-${wall}`, { separate: true, pivot: [0, 0, z] });
        part.add(k.mesh(k.arch.wall({ width: outerW, height: H, thickness: T, openings: openingsOf(wall) }), wallMat, { name: `wall-${wall}`, at: [0, 0, z] }));
        asset.add(part);
      }
      for (const [wall, x] of [['left', -W / 2 - T / 2], ['right', W / 2 + T / 2]]) {
        const part = k.part(`wall-${wall}`, { separate: true, pivot: [x, 0, 0] });
        // Turned so the wall's own x axis runs along world +Z (opening offsets are world coordinates).
        const g = k.op.rotate(k.arch.wall({ width: D, height: H, thickness: T, openings: openingsOf(wall) }), 0, -Math.PI / 2, 0);
        part.add(k.mesh(g, wallMat, { name: `wall-${wall}`, at: [x, 0, 0] }));
        asset.add(part);
      }
      if (p.room.ceiling) {
        const ceiling = k.part('ceiling', { separate: true, pivot: [0, H, 0] });
        ceiling.add(k.mesh(k.geo.box(outerW, CEILING_THICKNESS, outerD), mat('ceiling'), { name: 'ceiling', at: [0, H + CEILING_THICKNESS / 2, 0] }));
        asset.add(ceiling);
      }
      return asset;
    },
  });
}

const PIPELINE_DIRS = [paths.kit, path.join(paths.root, 'studio', 'core'), paths.profiles];

function shellHash(room, profileId) {
  return hashDirs([...PIPELINE_DIRS, scenePaths.code], `${KIT_VERSION}|shell|${profileId}|${JSON.stringify(room)}`);
}

/**
 * Build (or reuse) the shell GLB of a scene's room for one profile.
 * @returns {Promise<{glb: Uint8Array, info: object, cached: boolean}>} info: { hash, sha256, triangles, meshes, issues, counts, ok }
 */
export async function buildShell({ name, room, title, profileId = 'generic', write = true, force = false }) {
  const profile = loadProfile(profileId);
  const hash = shellHash(room, profileId);
  const glbFile = shellGlb(name, profileId);
  const infoFile = shellInfo(name, profileId);
  if (!force && write && fs.existsSync(glbFile) && fs.existsSync(infoFile)) {
    const prev = readJson(infoFile, null);
    if (prev && prev.hash === hash) return { glb: new Uint8Array(fs.readFileSync(glbFile)), info: prev, cached: true };
  }
  const def = shellDefinition(room, { title });
  const run = runAsset(def);
  const ir = sceneToIR(run.root, { slug: 'room', meta: def.meta });
  await applyProfile(ir, profile, {});
  const { glb } = await irToGLB(ir, { profileId, allowEmissiveStrength: profile.materials.emissiveStrength, extras: { title: def.meta.title, kit: KIT_VERSION } });
  const inspected = await inspectGLB(glb);
  const validation = await validate({ glb, info: inspected, ir, profile, meta: def.meta, sourceFiles: [] });
  const info = {
    hash,
    sha256: sha256(glb),
    triangles: inspected.triangles,
    meshes: inspected.meshes.length,
    ok: validation.counts.error === 0,
    counts: validation.counts,
    issues: validation.issues.map((i) => ({ id: i.id, severity: i.severity, message: i.message, ...(i.hint ? { hint: i.hint } : {}), ...(i.where ? { where: i.where } : {}) })),
  };
  if (write) {
    writeFileAtomic(glbFile, glb);
    writeJson(infoFile, info);
  }
  return { glb, info, cached: false };
}
