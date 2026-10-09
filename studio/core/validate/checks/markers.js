// Marker checks: attachments (k.attach) and colliders (k.collider / meta.collision).
// Values in the IR are already in the profile's units, like the GLB bounds.

import { issue } from '../issues.js';

const MAX_COLLIDERS = 12;

/** Radius of the sphere around a collider (its own rotation does not matter for these checks). */
function reach(c) {
  if (c.shape === 'sphere') return c.size[0];
  if (c.shape === 'cylinder') return Math.hypot(c.size[0], c.size[1] / 2);
  return Math.hypot(c.size[0], c.size[1], c.size[2]) / 2;
}

/** Distance from a point to an axis-aligned box (0 inside). */
function distanceToBox(p, box) {
  return Math.hypot(...[0, 1, 2].map((i) => Math.max(box.min[i] - p[i], 0, p[i] - box.max[i])));
}

export function checkMarkers({ info, ir, meta }) {
  const out = [];
  const attachments = ir.attachments || [];
  const colliders = ir.colliders || [];
  const box = info.bbox;
  const largest = Math.max(...box.size) || 1;
  for (const c of colliders) {
    const r = reach(c);
    if (distanceToBox(c.position, box) > r + largest * 0.02) {
      out.push(issue('collider.outside-asset', 'warning', `collider '${c.name}' does not touch the asset`, { where: c.name, hint: 'Check its position: `at` is the center of the shape, in the space of the part it was added to.' }));
    } else if (r > largest * 1.5) {
      out.push(issue('collider.oversized', 'warning', `collider '${c.name}' is much larger than the asset`, { where: c.name, hint: 'Sizes are meters: box(width, height, depth), sphere(radius), cylinder(radius, height).' }));
    }
  }
  if (colliders.length > MAX_COLLIDERS) {
    out.push(issue('collider.count', 'warning', `${colliders.length} collision shapes (keep it to ${MAX_COLLIDERS} or fewer: every shape costs physics time)`, { hint: 'Cover the silhouette with a few boxes; small details do not need their own shape.' }));
  }
  for (const a of attachments) {
    if (distanceToBox(a.position, box) > largest) {
      out.push(issue('attachment.far', 'warning', `attachment '${a.name}' is far from the asset`, { where: a.name, hint: '`at` is in the space of the part the attachment was added to (meters).' }));
    }
  }
  if (meta?.category === 'weapon' && !attachments.some((a) => a.name === 'grip')) {
    out.push(issue('attachment.weapon-grip', 'info', "weapon without a 'grip' attachment: the engine cannot place it in a hand by itself", { hint: "Add k.attach('grip', { at, forward }) where the hand holds it (rules/15-weapons.md)." }));
  }
  return out;
}
