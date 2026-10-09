// Placement math shared by the browser composer and scene validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceBox, snapValue, snapToWalls, wallGaps, outsideRoom, boxOverlap, nextInstanceId, normalizeYaw, STUD, arrayCopies, copyInstances, groupBox, turnAround, instancesInRect, nextGroupId } from '../studio/viewport/snap.js';

const room = { width: 6, depth: 4, height: 3 };
// A sofa-like footprint: 2 m wide, 0.8 m deep, 0.9 m tall, origin at its base center.
const sofa = { min: [-1, 0, -0.4], max: [1, 0.9, 0.4] };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('instanceBox rotates the footprint with yaw', () => {
  const flat = instanceBox([1, 0, 2], 0, sofa);
  assert.deepEqual(flat.min.map((v) => +v.toFixed(6)), [0, 0, 1.6]);
  assert.deepEqual(flat.max.map((v) => +v.toFixed(6)), [2, 0.9, 2.4]);
  const turned = instanceBox([1, 0.5, 2], 90, sofa);
  assert.deepEqual(turned.min.map((v) => +v.toFixed(6)), [0.6, 0.5, 1]);
  assert.deepEqual(turned.max.map((v) => +v.toFixed(6)), [1.4, 1.4, 3]);
});

test('grid snapping, yaw normalizing and instance ids', () => {
  close(snapValue(0.37, 0.25), 0.25);
  close(snapValue(0.4, STUD), 0.28);
  assert.equal(snapValue(0.37, 0), 0.37, 'step 0 = no snapping');
  assert.equal(normalizeYaw(-90), 270);
  assert.equal(normalizeYaw(720), 0);
  assert.equal(nextInstanceId('hospital-props-hospital-bed', ['hospital-bed-1']), 'hospital-bed-2');
  assert.equal(nextInstanceId('crate', new Set()), 'crate-1');
});

test('wall snap: flush against the nearest wall, front turned toward the room', () => {
  // Close to the back wall (z = −2): moved flush, facing +Z.
  const back = snapToWalls([0.3, 0, -1.55], 37, sofa, room);
  assert.deepEqual(back.walls, ['back']);
  assert.equal(back.yaw, 0);
  close(back.position[2], -1.6);
  close(wallGaps(instanceBox(back.position, back.yaw, sofa), room).back, 0);
  // Close to the left wall: turned 90° so its back is on the wall.
  const left = snapToWalls([-2.5, 0, 0.2], 0, sofa, room);
  assert.deepEqual(left.walls, ['left']);
  assert.equal(left.yaw, 90);
  close(left.position[0], -2.6);
  // Without `align` the yaw is kept and only the position moves.
  const kept = snapToWalls([-2.1, 0, 0.2], 0, sofa, room, { align: false });
  assert.equal(kept.yaw, 0);
  close(kept.position[0], -2);
  // A corner: flush against two walls.
  const corner = snapToWalls([-1.95, 0, -1.55], 0, sofa, room);
  assert.deepEqual(corner.walls, ['back', 'left']);
  close(corner.position[0], -2);
  close(corner.position[2], -1.6);
  // In the middle of the room nothing happens; without a room nothing happens.
  assert.deepEqual(snapToWalls([0, 0, 0], 12, sofa, room), { position: [0, 0, 0], yaw: 12, walls: [] });
  assert.deepEqual(snapToWalls([9, 0, 9], 12, sofa, null).walls, []);
});

test('outsideRoom and boxOverlap measure placement problems', () => {
  const poking = outsideRoom(instanceBox([2.5, 0, 0], 0, sofa), room);
  close(poking.right, 0.5);
  assert.equal(poking.left + poking.front + poking.back + poking.floor + poking.ceiling, 0);
  close(outsideRoom(instanceBox([0, 2.5, 0], 0, sofa), room).ceiling, 0.4);
  const a = instanceBox([0, 0, 0], 0, sofa);
  assert.deepEqual(boxOverlap(a, instanceBox([1.5, 0, 0], 0, sofa)).map((v) => +v.toFixed(6)), [0.5, 0.9, 0.8]);
  // Stacked: touching in height only is not an overlap.
  assert.equal(boxOverlap(a, instanceBox([0, 0.9, 0], 0, sofa))[1], 0);
});

// A table with two chairs as one group, and a loose crate.
const block = [
  { id: 'tavern-table-1', asset: 'tavern-table', variant: null, skin: null, position: [0, 0, 0], yaw: 0, group: 'group-1', name: 'Main table' },
  { id: 'tavern-stool-1', asset: 'tavern-stool', variant: null, skin: null, position: [0, 0, 0.7], yaw: 0, group: 'group-1' },
  { id: 'crate-1', asset: 'crate', variant: 'open', skin: null, position: [2, 0.5, 0], yaw: 90, locked: true },
];
const unit = () => ({ min: [-0.5, 0, -0.25], max: [0.5, 1, 0.25] });

test('arrayCopies repeats a block on a grid with fresh ids and a new group per cell', () => {
  const used = new Set(block.map((inst) => inst.id));
  const groups = new Set(['group-1']);
  const copies = arrayCopies(block, { columns: 3, rows: 2, dx: 2.5, dz: -4 }, used, groups);
  assert.equal(copies.length, block.length * 5, 'every cell except the block itself');
  assert.equal(new Set([...copies.map((c) => c.id), ...block.map((b) => b.id)]).size, 18, 'ids are unique');
  // Cells run along X first, then Z.
  assert.deepEqual(copies.slice(0, 3).map((c) => c.position), [[2.5, 0, 0], [2.5, 0, 0.7], [4.5, 0.5, 0]]);
  assert.deepEqual(copies.slice(6, 9).map((c) => c.position), [[0, 0, -4], [0, 0, -3.3], [2, 0.5, -4]]);
  assert.deepEqual(copies.slice(0, 3).map((c) => c.id), ['tavern-table-2', 'tavern-stool-2', 'crate-2']);
  // The grouped pair stays a pair, in its own group; the loose crate stays loose.
  assert.deepEqual(copies.slice(0, 3).map((c) => c.group), ['group-2', 'group-2', undefined]);
  assert.deepEqual([...new Set(copies.map((c) => c.group).filter(Boolean))], ['group-2', 'group-3', 'group-4', 'group-5', 'group-6']);
  // Everything else is kept; a label is not copied.
  assert.deepEqual([copies[2].variant, copies[2].yaw, copies[2].locked, copies[0].name], ['open', 90, true, undefined]);
  assert.equal(block[0].id, 'tavern-table-1', 'the source is not changed');
  assert.deepEqual(arrayCopies(block, { columns: 1, rows: 1 }, new Set()), []);
  assert.deepEqual(copyInstances([block[2]], [0.25, 0, 0.25], new Set(['crate-1']), new Set()).map((c) => [c.id, c.position]), [['crate-2', [2.25, 0.5, 0.25]]]);
  assert.equal(nextGroupId(['group-1', 'group-3']), 'group-2');
});

test('groupBox, turnAround and instancesInRect work on blocks', () => {
  const box = groupBox(block, unit);
  assert.deepEqual(box.min.map((v) => +v.toFixed(6)), [-0.5, 0, -0.5]); // the crate is turned 90°: its 1 m side runs along Z
  assert.deepEqual(box.max.map((v) => +v.toFixed(6)), [2.25, 1.5, 0.95]);
  assert.equal(groupBox([], unit), null);
  // A quarter turn around the origin: +Z goes to +X, +X goes to −Z; yaw follows.
  const turned = turnAround(block, [0, 0], 90);
  assert.deepEqual(turned.map((t) => [t.id, t.position, t.yaw]), [
    ['tavern-table-1', [0, 0, 0], 90],
    ['tavern-stool-1', [0.7, 0, 0], 90],
    ['crate-1', [0, 0.5, -2], 180],
  ]);
  assert.deepEqual(turnAround([block[1]], [1, 1], 360)[0], { id: 'tavern-stool-1', position: [0, 0, 0.7], yaw: 0 });
  // A rectangle on the floor selects what it touches, not just centers inside it.
  assert.deepEqual(instancesInRect(block, unit, { minX: 0.4, maxX: 1.6, minZ: -1, maxZ: 0.1 }), ['tavern-table-1']);
  assert.deepEqual(instancesInRect(block, unit, { minX: -1, maxX: 3, minZ: -1, maxZ: 1 }), ['tavern-table-1', 'tavern-stool-1', 'crate-1']);
  assert.deepEqual(instancesInRect(block, unit, { minX: 5, maxX: 6, minZ: 5, maxZ: 6 }), []);
});
