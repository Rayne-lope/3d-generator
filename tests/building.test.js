import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useFixtures, errors } from './helpers.js';

useFixtures();
const { k } = await import('../studio/kit/index.js');
const { buildItem } = await import('../studio/core/build.js');

const tris = (zones) => Object.values(zones).reduce((s, g) => s + g.attributes.position.count / 3, 0);

test('plan: symmetric odd bays on the entrance side with the door on the center bay', () => {
  const p = k.arch.plan({ style: 'georgian', masses: [{ width: 20, depth: 12, floors: 3 }] });
  const front = p.masses[0].sides.front;
  assert.equal(front.bays % 2, 1, `front bays ${front.bays}`);
  const doors = p.slots.filter((s) => s.role === 'door');
  assert.equal(doors.length, 1);
  assert.equal(doors[0].side, 'front');
  assert.equal(doors[0].floor, 0);
  assert.ok(Math.abs(doors[0].u - 10) < 1e-6, 'door centered on the facade');
  // Every floor has the same bay grid (windows line up vertically).
  const us = (f) => p.slots.filter((s) => s.side === 'front' && s.floor === f).map((s) => s.u.toFixed(4));
  assert.deepEqual(us(1), us(2));
  assert.deepEqual(new Set(p.slots.filter((s) => s.floor === 1).map((s) => s.floorRole)), new Set(['noble']));
});

test('plan: a wing hides the part of the main wall it covers, only on the floors it reaches', () => {
  const p = k.arch.plan({
    style: 'georgian',
    masses: [
      { id: 'main', width: 20, depth: 12, floors: 3 },
      { id: 'wing', x: 14, z: -1, width: 9, depth: 8, floors: 2 },
    ],
  });
  const right = p.masses[0].sides.right;
  assert.ok(right.floors[0].hidden.length === 1, 'ground floor partly hidden');
  assert.ok(right.floors[1].hidden.length === 1, 'first floor partly hidden');
  assert.equal(right.floors[2].hidden.length, 0, 'top floor is above the two-storey wing');
  const [a, b] = right.floors[0].hidden[0];
  for (const s of p.slots.filter((x) => x.mass === 'main' && x.side === 'right' && x.floor < 2)) {
    assert.ok(s.u + 0.5 < a || s.u - 0.5 > b, `window at u=${s.u} is not inside the hidden part [${a}, ${b}]`);
  }
  assert.ok(p.slots.some((s) => s.mass === 'main' && s.side === 'right' && s.floor === 2 && s.u > a && s.u < b), 'top-floor windows above the wing');
  // The wing's own side against the main block has no windows there.
  const wingLeft = p.masses[1].sides.left;
  assert.ok(wingLeft.floors.every((f) => !f.visible), 'wing side inside the main block is hidden');
});

test('plan: jettied floors grow on their sides and keep windows on the same bays', () => {
  const p = k.arch.plan({ style: 'medieval-timber', masses: [{ width: 7, depth: 6, floors: 3, jetty: { amount: 0.4, sides: ['front', 'back'] } }] });
  const m = p.masses[0];
  assert.ok(Math.abs(k.arch.massRect(m, 2).z1 - k.arch.massRect(m, 0).z1 - 0.8) < 1e-9, 'two jetties of 0.4 m');
  const right = m.sides.right;
  assert.ok(Math.abs(right.floors[2].shift - 0.8) < 1e-9, 'side walls start 0.8 m further out at the top floor');
});

test('build: deterministic, and a tight budget lowers the detail level', () => {
  const spec = { style: 'georgian', masses: [{ width: 16, depth: 11, floors: 3 }] };
  const a = k.arch.build(k.arch.plan(spec));
  const b = k.arch.build(k.arch.plan(spec));
  assert.equal(a.stats.detail, 2);
  assert.equal(a.stats.triangles, b.stats.triangles);
  assert.deepEqual(Array.from(a.zones.wall.attributes.position.array.slice(0, 30)), Array.from(b.zones.wall.attributes.position.array.slice(0, 30)));
  const tight = k.arch.build(k.arch.plan(spec), { budget: Math.round(a.stats.triangles * 0.6) });
  assert.ok(tight.stats.detail < 2, `detail ${tight.stats.detail}`);
  assert.ok(tight.stats.triangles < a.stats.triangles);
  assert.equal(tris(tight.zones), tight.stats.triangles);
});

test('every style builds, with one material per zone and tiling UVs', () => {
  for (const style of Object.keys(k.arch.styles)) {
    const b = k.arch.building({ name: 'b', style, masses: [{ width: 12, depth: 9, floors: 3 }], texSize: 64 });
    assert.ok(b.stats.triangles > 500, `${style}: ${b.stats.triangles} triangles`);
    assert.ok(b.part.children.length >= 4, `${style}: ${b.part.children.length} meshes`);
    for (const zone of ['wall', 'roof', 'glass']) assert.ok(b.stats.perZone[zone] > 0, `${style} has ${zone}`);
  }
  assert.throws(() => k.arch.plan({ style: 'gothic', masses: [{ width: 5, depth: 5 }] }), /unknown style 'gothic'/);
  assert.throws(() => k.arch.plan({ masses: [] }), /masses/);
  const custom = k.arch.resolveStyle({ extends: 'georgian', roof: { type: 'gable' } });
  assert.equal(custom.roof.type, 'gable');
  assert.equal(custom.roof.pitch, 30, 'unlisted fields come from the base style');
});

test('Roblox: large tiling surfaces are cut on the tile grid so UVs fit 0..1 at full sharpness', async () => {
  const { report } = await buildItem({ slug: 'fx-big-tiling', profileId: 'roblox', write: false });
  assert.deepEqual(errors(report), []);
  assert.ok(report.notes.some((n) => /wrapped into 4×4/.test(typeof n === 'string' ? n : n.message)), 'wrap note');
  const tex = report.textures.find((t) => /fx_bricks/.test(t.name));
  assert.ok(tex.texelDensity >= 90, `density ${tex.texelDensity}`);
});
