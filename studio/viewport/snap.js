// Placement math for the scene composer. Pure functions with no imports, so the browser
// (snapping while dragging) and Node (scene validation) use exactly the same rules.
//
// Conventions: meters, +Y up, room centered on the origin with the floor at y = 0.
// Walls: front = +Z, back = −Z, left = −X, right = +X. Yaw is in degrees around +Y
// (three.js rotation.y), 0 = the asset's front (+Z) facing the room's front wall.

export const STUD = 0.28;
export const WALLS = ['front', 'back', 'left', 'right'];
/** Yaw that turns an asset's front toward the inside of the room when it stands at a wall. */
export const WALL_YAW = { back: 0, left: 90, front: 180, right: 270 };

export function normalizeYaw(deg) {
  const y = ((deg % 360) + 360) % 360;
  return Math.abs(y - 360) < 1e-9 ? 0 : y;
}

export function snapValue(value, step) {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** Local point rotated by yaw (degrees) around Y. */
export function rotateXZ(x, z, yaw) {
  const a = (yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

/**
 * World axis-aligned box of an instance: the asset's local bounds ({ min, max } in meters)
 * rotated by yaw and moved to position.
 */
export function instanceBox(position, yaw, bounds) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const z of [bounds.min[2], bounds.max[2]]) {
      const [rx, rz] = rotateXZ(x, z, yaw);
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (rz < minZ) minZ = rz;
      if (rz > maxZ) maxZ = rz;
    }
  }
  return {
    min: [position[0] + minX, position[1] + bounds.min[1], position[2] + minZ],
    max: [position[0] + maxX, position[1] + bounds.max[1], position[2] + maxZ],
  };
}

/** Inside faces of the room shell. */
export function roomInterior(room) {
  return { minX: -room.width / 2, maxX: room.width / 2, minZ: -room.depth / 2, maxZ: room.depth / 2, height: room.height };
}

/** Signed gap between a box and each wall (negative = pokes through the wall). */
export function wallGaps(box, room) {
  const r = roomInterior(room);
  return { back: box.min[2] - r.minZ, front: r.maxZ - box.max[2], left: box.min[0] - r.minX, right: r.maxX - box.max[0] };
}

/**
 * Snap an instance to the walls it is close to.
 * The nearest wall within `threshold` wins: the box is moved flush against it and, with
 * `align`, turned so its front faces the room. A second wall in reach (a corner) only moves it.
 * @returns {{position: number[], yaw: number, walls: string[]}}
 */
export function snapToWalls(position, yaw, bounds, room, { threshold = 0.15, align = true } = {}) {
  if (!room) return { position: [...position], yaw, walls: [] };
  let pos = [...position];
  let outYaw = yaw;
  const walls = [];
  let gaps = wallGaps(instanceBox(pos, outYaw, bounds), room);
  const near = WALLS.filter((w) => gaps[w] < threshold).sort((a, b) => gaps[a] - gaps[b]);
  if (!near.length) return { position: pos, yaw: outYaw, walls };
  if (align) outYaw = WALL_YAW[near[0]];
  const push = (wall) => {
    const g = wallGaps(instanceBox(pos, outYaw, bounds), room)[wall];
    if (wall === 'back') pos[2] -= g;
    else if (wall === 'front') pos[2] += g;
    else if (wall === 'left') pos[0] -= g;
    else pos[0] += g;
    walls.push(wall);
  };
  push(near[0]);
  // After turning, a perpendicular wall may be in reach too (corner).
  gaps = wallGaps(instanceBox(pos, outYaw, bounds), room);
  const opposite = { front: 'back', back: 'front', left: 'right', right: 'left' };
  const second = WALLS.filter((w) => w !== near[0] && w !== opposite[near[0]] && gaps[w] < threshold).sort((a, b) => gaps[a] - gaps[b])[0];
  if (second) push(second);
  return { position: pos, yaw: outYaw, walls };
}

/** Overlap of two boxes along each axis (0 when they do not intersect on that axis). */
export function boxOverlap(a, b) {
  return [0, 1, 2].map((i) => Math.max(0, Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i])));
}

/** How far a box sticks out of the room on each side (0 when inside). */
export function outsideRoom(box, room) {
  const g = wallGaps(box, room);
  return {
    back: Math.max(0, -g.back), front: Math.max(0, -g.front), left: Math.max(0, -g.left), right: Math.max(0, -g.right),
    floor: Math.max(0, -box.min[1]), ceiling: Math.max(0, box.max[1] - room.height),
  };
}

/** A fresh instance id for an asset slug: the last word of the slug plus a counter. */
export function nextInstanceId(slug, usedIds) {
  const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
  const words = slug.split('-').filter(Boolean);
  let base = words.slice(-2).join('-');
  if (base.length > 40 || !/^[a-z0-9]/.test(base)) base = words[words.length - 1] || 'item';
  for (let n = 1; ; n++) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
}

// ------------------------------------------------------------------ blocks of instances

/** A fresh group id ('group-1', 'group-2', …). */
export function nextGroupId(usedGroups) {
  const used = usedGroups instanceof Set ? usedGroups : new Set(usedGroups);
  for (let n = 1; ; n++) {
    const id = `group-${n}`;
    if (!used.has(id)) return id;
  }
}

/** World box around several instances ({ min, max }), or null for none. boundsOf(inst) → local bounds. */
export function groupBox(instances, boundsOf) {
  let box = null;
  for (const inst of instances) {
    const b = instanceBox(inst.position, inst.yaw, boundsOf(inst));
    if (!box) box = { min: [...b.min], max: [...b.max] };
    else {
      for (let i = 0; i < 3; i++) {
        box.min[i] = Math.min(box.min[i], b.min[i]);
        box.max[i] = Math.max(box.max[i], b.max[i]);
      }
    }
  }
  return box;
}

/**
 * Copies of `instances` moved by `offset` ([x, y, z] meters), with fresh ids. Members of one
 * group stay together in a new group. `usedIds` and `usedGroups` (Sets) are extended.
 */
export function copyInstances(instances, offset, usedIds, usedGroups) {
  const groups = new Map();
  return instances.map((inst) => {
    const copy = JSON.parse(JSON.stringify(inst));
    copy.id = nextInstanceId(inst.asset, usedIds);
    usedIds.add(copy.id);
    copy.position = inst.position.map((v, i) => +(v + offset[i]).toFixed(4));
    delete copy.name;
    if (inst.group) {
      if (!groups.has(inst.group)) {
        const id = nextGroupId(usedGroups);
        usedGroups.add(id);
        groups.set(inst.group, id);
      }
      copy.group = groups.get(inst.group);
    }
    return copy;
  });
}

/**
 * Repeat a block of instances on a grid: `columns` along X every `dx` meters, `rows` along Z
 * every `dz` meters. Returns only the new instances (the block itself is cell 0, 0).
 */
export function arrayCopies(instances, { columns = 1, rows = 1, dx = 0, dz = 0 }, usedIds, usedGroups = new Set()) {
  const ids = usedIds instanceof Set ? usedIds : new Set(usedIds);
  const groups = usedGroups instanceof Set ? usedGroups : new Set(usedGroups);
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (!row && !column) continue;
      out.push(...copyInstances(instances, [column * dx, 0, row * dz], ids, groups));
    }
  }
  return out;
}

/** Instances turned `deg` degrees around the vertical line through pivot ([x, z]): new position and yaw per id. */
export function turnAround(instances, pivot, deg) {
  return instances.map((inst) => {
    const [x, z] = rotateXZ(inst.position[0] - pivot[0], inst.position[2] - pivot[1], deg);
    return { id: inst.id, position: [+(pivot[0] + x).toFixed(4), inst.position[1], +(pivot[1] + z).toFixed(4)], yaw: +normalizeYaw(inst.yaw + deg).toFixed(2) % 360 };
  });
}

/** Ids of the instances whose box touches a rectangle on the floor ({ minX, maxX, minZ, maxZ }). */
export function instancesInRect(instances, boundsOf, rect) {
  return instances.filter((inst) => {
    const b = instanceBox(inst.position, inst.yaw, boundsOf(inst));
    return b.max[0] >= rect.minX && b.min[0] <= rect.maxX && b.max[2] >= rect.minZ && b.min[2] <= rect.maxZ;
  }).map((inst) => inst.id);
}
