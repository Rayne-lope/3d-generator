// Scene-level checks: references, placement and engine totals.
// Member assets keep their own validation; a member with errors blocks the scene export.

import { issue } from '../core/validate/issues.js';
import { itemId } from '../core/paths.js';
import { instanceBox, outsideRoom, boxOverlap } from '../viewport/snap.js';

const TOLERANCE = 0.01;

/**
 * @param {{scene: any, members: Map<string, any>, profile: any, info?: any}} ctx
 *   members: item id → { report } | { error } | { missing: 'asset'|'variant'|'skin' }
 *   info: inspectGLB() of the composed scene (totals), when it was composed
 */
export function checkSceneLayout({ scene, members, profile, info = null }) {
  const out = [];
  const boxes = [];
  for (const inst of scene.instances) {
    const id = itemId(inst.asset, inst.variant, inst.skin);
    const member = members.get(id);
    if (!member || member.missing) {
      const what = member?.missing === 'variant' ? `variant '${inst.variant}' of asset '${inst.asset}'` : member?.missing === 'skin' ? `skin '${inst.skin}' of asset '${inst.asset}'` : `asset '${inst.asset}'`;
      out.push(issue(`scene.unknown-${member?.missing || 'asset'}`, 'error', `instance '${inst.id}' uses ${what}, which does not exist`, { where: inst.id, hint: 'Run `node studio scene library` for the assets, variants and skins you can place.' }));
      continue;
    }
    if (member.error) continue;
    const bounds = member.bounds;
    const box = instanceBox(inst.position, inst.yaw, bounds);
    boxes.push({ inst, box });
    if (scene.room) {
      const o = outsideRoom(box, scene.room);
      const sides = Object.entries(o).filter(([, v]) => v > TOLERANCE);
      if (sides.length) {
        out.push(issue('scene.outside-room', 'warning', `instance '${inst.id}' sticks out of the room: ${sides.map(([side, v]) => `${side} by ${(v * 100).toFixed(0)} cm`).join(', ')}`, { where: inst.id, hint: 'Move it inside, or enlarge the room.' }));
      }
    } else if (box.min[1] < -TOLERANCE) {
      out.push(issue('scene.below-ground', 'warning', `instance '${inst.id}' is ${(-box.min[1] * 100).toFixed(0)} cm below y = 0`, { where: inst.id }));
    }
  }
  for (const [id, member] of members) {
    if (member.error) out.push(issue('scene.member-build-failed', 'error', `asset '${id}' does not build: ${member.error.split('\n')[0]}`, { where: id, hint: `Fix the asset first: node studio build ${id}` }));
    else if (member.report && member.report.counts.error > 0) {
      out.push(issue('scene.member-errors', 'error', `asset '${id}' has ${member.report.counts.error} validation error(s) for ${profile.label}`, { where: id, hint: `Fix the asset first: node studio review ${id} --profile ${profile.id}` }));
    }
  }
  // Overlaps are common on purpose (a stool under a table), so they are only a note.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      // Members of one group are arranged on purpose (chairs pushed under their table).
      if (boxes[i].inst.group && boxes[i].inst.group === boxes[j].inst.group) continue;
      const [x, y, z] = boxOverlap(boxes[i].box, boxes[j].box);
      if (x > 0.05 && y > 0.05 && z > 0.05) {
        out.push(issue('scene.overlap', 'info', `'${boxes[i].inst.id}' and '${boxes[j].inst.id}' overlap (bounding boxes share ${(x * 100).toFixed(0)} × ${(y * 100).toFixed(0)} × ${(z * 100).toFixed(0)} cm)`, { where: boxes[i].inst.id }));
      }
    }
  }
  if (!scene.instances.length && !scene.room) out.push(issue('scene.empty', 'error', 'the scene has no room and no instances', { hint: 'Add a room spec or place an asset.' }));
  if (info) {
    const g = profile.geometry;
    if (g.warnTrianglesTotal && info.triangles > g.warnTrianglesTotal) {
      out.push(issue('scene.triangles-total', 'warning', `${info.triangles.toLocaleString('en-US')} triangles in the scene (recommended ≤ ${g.warnTrianglesTotal.toLocaleString('en-US')} for ${profile.label})`, { hint: 'Use lighter variants for repeated props, or split the scene.' }));
    }
    if (g.warnMeshes && info.meshes.length > g.warnMeshes) {
      out.push(issue('scene.mesh-count', 'warning', `${info.meshes.length} meshes in the scene (each is a draw call / MeshPart; recommended ≤ ${g.warnMeshes} for ${profile.label})`));
    }
  }
  return out;
}
