// Scenes: schema, room shell, composing one GLB per scene, validation gates, strict export
// and checkpoints. Runs against the fixture assets and a throwaway scenes folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useFixtures } from './helpers.js';

useFixtures();
process.env.STUDIO_SCENES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-scenes-'));

const { normalizeScene, createScene, readScene, writeScene, listScenes, sceneRevision, parseRoomSize, SceneError } = await import('../studio/scene/schema.js');
const { composeScene, yawQuaternion } = await import('../studio/scene/compose.js');
const { exportScene } = await import('../studio/scene/export.js');
const { buildShell } = await import('../studio/scene/shell.js');
const { libraryEntries } = await import('../studio/scene/library.js');
const { saveSceneVersion, restoreSceneVersion, listSceneVersions, sceneWorkingState } = await import('../studio/scene/snapshots.js');
const { createIO } = await import('../studio/core/ir/to-gltf.js');
const { inspectGLB } = await import('../studio/core/inspect.js');
const { buildItem } = await import('../studio/core/build.js');

const scene = (extra = {}) => ({
  version: 1,
  title: 'Test room',
  room: { width: 6, depth: 4, height: 3, openings: [{ wall: 'front', offset: -1.5, w: 0.9, h: 2.1 }, { wall: 'left', offset: 0.5, y: 0.9, w: 1.2, h: 1.2 }] },
  instances: [
    { id: 'a-1', asset: 'kit-test', position: [0, 0, 0], yaw: 0 },
    { id: 'a-2', asset: 'kit-test', position: [1.5, 0, -1], yaw: 90 },
    { id: 'a-3', asset: 'kit-test', position: [-1.5, 0, 1], yaw: 180 },
    { id: 'b-1', asset: 'fx-padding-ok', position: [2, 0, 1], yaw: 45 },
  ],
  ...extra,
});

const expectSceneError = (fn, field) => assert.throws(fn, (err) => err instanceof SceneError && (field === undefined || err.field === field), `expected a SceneError on ${field}`);

test('scene schema: canonical form, defaults and rejected input', () => {
  const s = normalizeScene({ version: 1, room: { width: 5, depth: 3 }, instances: [{ id: 'x-1', asset: 'kit-test', position: [0.123456, 0, -0], yaw: -90 }] }, { name: 'demo' });
  assert.equal(s.title, 'demo');
  assert.deepEqual([s.room.height, s.room.wallThickness, s.room.ceiling], [3, 0.2, true]);
  assert.equal(s.room.finishes.wall.kind, 'plaster');
  assert.deepEqual(s.instances[0].position, [0.1235, 0, 0]);
  assert.equal(s.instances[0].yaw, 270, 'yaw is kept in 0..360');
  assert.deepEqual(normalizeScene(s, { name: 'demo' }), s, 'normalizing is idempotent');
  assert.equal(normalizeScene({ version: 1, room: null, instances: [] }).room, null);

  expectSceneError(() => normalizeScene({ version: 2, instances: [] }), 'version');
  expectSceneError(() => normalizeScene({ version: 1, room: { width: 0.2, depth: 3 }, instances: [] }), 'room.width');
  expectSceneError(() => normalizeScene({ version: 1, instances: [{ id: 'Bad Id', asset: 'kit-test' }] }), 'instances[0].id');
  expectSceneError(() => normalizeScene({ version: 1, instances: [{ id: 'a', asset: 'kit-test' }, { id: 'a', asset: 'kit-test' }] }), 'instances[1].id');
  expectSceneError(() => normalizeScene({ version: 1, instances: [{ id: 'a', asset: 'kit-test', position: [0, NaN, 0] }] }), 'instances[0].position[1]');
  expectSceneError(() => normalizeScene({ version: 1, instances: [{ id: 'a', asset: '../etc' }] }), 'instances[0].asset');
  // Openings must fit their wall and must not collide.
  expectSceneError(() => normalizeScene({ version: 1, room: { width: 4, depth: 3, openings: [{ wall: 'front', offset: 1.8, w: 0.9, h: 2.1 }] }, instances: [] }), 'room.openings[0]');
  expectSceneError(() => normalizeScene({ version: 1, room: { width: 4, depth: 3, openings: [{ wall: 'back', offset: 0, w: 1, h: 3 }] }, instances: [] }), 'room.openings[0]');
  expectSceneError(() => normalizeScene({ version: 1, room: { width: 6, depth: 3, openings: [{ wall: 'back', offset: 0, w: 1, h: 2 }, { wall: 'back', offset: 0.5, w: 1, h: 2 }] }, instances: [] }), 'room.openings');
  assert.deepEqual(parseRoomSize('6x4.5'), { width: 6, depth: 4.5, height: 3 });
  assert.equal(parseRoomSize('none'), null);
  expectSceneError(() => parseRoomSize('big'), 'room');
});

test('scene files: create, revision conflict and listing', () => {
  const created = createScene('files-demo', { title: 'Files', room: { width: 4, depth: 3, height: 2.6 } });
  assert.deepEqual(listScenes().includes('files-demo'), true);
  expectSceneError(() => createScene('files-demo'), 'name');
  expectSceneError(() => createScene('Not Valid'), 'name');
  const next = structuredClone(created.scene);
  next.instances.push({ id: 'k-1', asset: 'kit-test', position: [0, 0, 0] });
  const saved = writeScene('files-demo', next, { expectedRevision: created.revision });
  assert.notEqual(saved.revision, created.revision);
  assert.equal(sceneRevision('files-demo'), saved.revision);
  // A second writer still holding the old revision is refused.
  assert.throws(() => writeScene('files-demo', next, { expectedRevision: created.revision }), (err) => err.status === 409);
  assert.equal(readScene('files-demo').scene.instances.length, 1);
});

test('room shell: one node per surface, door notch and window hole, valid in every profile', async () => {
  const room = normalizeScene(scene()).room;
  for (const profileId of ['generic', 'roblox']) {
    const { glb, info } = await buildShell({ name: 'shell-demo', room, title: 'Shell', profileId });
    assert.equal(info.ok, true, JSON.stringify(info.issues));
    const inspected = await inspectGLB(glb);
    const names = inspected.nodes.filter((n) => n.hasMesh).map((n) => n.name).sort();
    assert.deepEqual(names, ['ceiling', 'floor', 'wall-back', 'wall-front', 'wall-left', 'wall-right']);
    const s = profileId === 'roblox' ? 25 / 7 : 1;
    // Outer size: room + two walls, floor slab below y = 0, ceiling slab above the wall height.
    assert.ok(Math.abs(inspected.bbox.size[0] - 6.4 * s) < 1e-3 && Math.abs(inspected.bbox.size[2] - 4.4 * s) < 1e-3, inspected.bbox.size.join(','));
    assert.ok(Math.abs(inspected.bbox.min[1] + 0.1 * s) < 1e-3 && Math.abs(inspected.bbox.max[1] - 3.1 * s) < 1e-3);
  }
  const again = await buildShell({ name: 'shell-demo', room, title: 'Shell', profileId: 'generic' });
  assert.equal(again.cached, true);
  // A wall with openings has more triangles than a plain one.
  const plain = await buildShell({ name: 'shell-plain', room: { ...room, openings: [] }, profileId: 'generic', write: false });
  const cut = await buildShell({ name: 'shell-demo', room, profileId: 'generic', write: false });
  assert.ok(cut.info.triangles > plain.info.triangles);
});

test('compose: one node per instance, shared meshes, transforms in meters and studs, deterministic', async () => {
  writeScene('compose-demo', scene());
  const generic = await composeScene({ name: 'compose-demo', profileId: 'generic' });
  assert.equal(generic.report.ok, true, JSON.stringify(generic.report.issues));
  assert.equal(generic.report.instanceCount, 4);
  assert.equal(generic.report.items.find((i) => i.item === 'kit-test').count, 3);

  const doc = await createIO().readBinary(generic.glb);
  const root = doc.getRoot();
  assert.equal(root.listScenes().length, 1);
  assert.equal(root.listBuffers().length, 1);
  const top = root.getDefaultScene().listChildren();
  assert.deepEqual(top.map((n) => n.getName()), ['room', 'a-1', 'a-2', 'a-3', 'b-1']);
  const byName = Object.fromEntries(top.map((n) => [n.getName(), n]));
  assert.deepEqual(byName['a-2'].getTranslation(), [1.5, 0, -1]);
  assert.deepEqual(byName['a-2'].getRotation().map((v) => +v.toFixed(6)), yawQuaternion(90).map((v) => +v.toFixed(6)));
  assert.equal(byName['a-2'].getExtras().studio.asset, 'kit-test');
  // The three kit-test instances point at the same mesh objects (glTF instancing).
  const meshesOf = (node) => { const out = []; node.traverse((n) => { if (n.getMesh()) out.push(n.getMesh()); }); return out; };
  const [m1, m2, m3] = ['a-1', 'a-2', 'a-3'].map((id) => meshesOf(byName[id]));
  assert.ok(m1.length > 0);
  assert.deepEqual(m1, m2);
  assert.deepEqual(m1, m3);
  const single = (await buildItem({ slug: 'kit-test', profileId: 'generic' })).report;
  const other = (await buildItem({ slug: 'fx-padding-ok', profileId: 'generic' })).report;
  assert.equal(generic.report.triangles.total, single.triangles.total * 3 + other.triangles.total + generic.report.triangles.room);

  // Same scene, same bytes; the second build is served from the cache.
  const fresh = await composeScene({ name: 'compose-demo', profileId: 'generic', write: false, force: true });
  assert.ok(Buffer.from(fresh.glb).equals(Buffer.from(generic.glb)), 'compose is deterministic');
  assert.equal((await composeScene({ name: 'compose-demo', profileId: 'generic' })).cached, true);

  // Roblox: the file is in studs, so the same placement is 25/7 times larger.
  const roblox = await composeScene({ name: 'compose-demo', profileId: 'roblox' });
  const rdoc = await createIO().readBinary(roblox.glb);
  const a2 = rdoc.getRoot().getDefaultScene().listChildren().find((n) => n.getName() === 'a-2');
  assert.deepEqual(a2.getTranslation().map((v) => +v.toFixed(4)), [+(1.5 * 25 / 7).toFixed(4), 0, +(-25 / 7).toFixed(4)]);
  assert.equal(rdoc.getRoot().getAsset().extras.studio.units.name, 'stud');
  assert.deepEqual(roblox.report.dimensions.meters, generic.report.dimensions.meters);
});

test('scene validation: unknown assets and member errors block, placement problems warn', async () => {
  writeScene('gates-demo', scene({
    instances: [
      { id: 'ok-1', asset: 'kit-test', position: [0, 0, 0] },
      { id: 'out-1', asset: 'kit-test', position: [2.95, 0, 0] },
      { id: 'ghost-1', asset: 'no-such-asset', position: [0, 0, 1] },
      { id: 'look-1', asset: 'kit-test', variant: 'no-such-variant', position: [1, 0, 1] },
    ],
  }));
  const { report } = await composeScene({ name: 'gates-demo', profileId: 'generic' });
  const ids = report.issues.map((i) => i.id);
  assert.equal(report.ok, false);
  assert.ok(ids.includes('scene.unknown-asset'), ids.join(','));
  assert.ok(ids.includes('scene.unknown-variant'), ids.join(','));
  assert.ok(report.issues.some((i) => i.id === 'scene.outside-room' && i.where === 'out-1' && i.severity === 'warning'), ids.join(','));
  assert.equal((await exportScene({ name: 'gates-demo', profileId: 'generic' })).blocked, true);

  // An asset that fails its own Roblox validation blocks the scene for Roblox only.
  writeScene('dense-demo', scene({ room: null, instances: [{ id: 'dense-1', asset: 'fx-dense', position: [0, 0, 0] }] }));
  const roblox = await exportScene({ name: 'dense-demo', profileId: 'roblox' });
  assert.equal(roblox.blocked, true);
  assert.ok(roblox.errors.some((e) => e.id === 'scene.member-errors'), roblox.errors.map((e) => e.id).join(','));
  assert.equal(fs.existsSync(path.join(process.env.STUDIO_EXPORTS_DIR, 'roblox', 'scenes', 'dense-demo.glb')), false);
});

test('strict scene export writes the preview bytes, reports and a layout in meters and studs', async () => {
  writeScene('export-demo', scene());
  const r = await exportScene({ name: 'export-demo', profileId: 'roblox' });
  assert.equal(r.blocked, false, r.reason);
  const dir = path.join(process.env.STUDIO_EXPORTS_DIR, 'roblox', 'scenes');
  const glb = fs.readFileSync(path.join(dir, 'export-demo.glb'));
  const preview = fs.readFileSync(path.join(process.env.STUDIO_STATE_DIR, 'scenes', 'export-demo', 'roblox.glb'));
  assert.ok(glb.equals(preview), 'export bytes equal the composed preview');
  const layout = JSON.parse(fs.readFileSync(path.join(dir, 'export-demo.layout.json'), 'utf8'));
  assert.equal(layout.instances.length, 4);
  assert.deepEqual(layout.instances[1].position.meters, [1.5, 0, -1]);
  assert.deepEqual(layout.instances[1].position.studs, [+(1.5 / 0.28).toFixed(4), 0, +(-1 / 0.28).toFixed(4)]);
  assert.equal(layout.room.studs.width, +(6 / 0.28).toFixed(4));
  const md = fs.readFileSync(path.join(dir, 'export-demo.report.md'), 'utf8');
  assert.match(md, /\| kit-test \| 3 \|/);
  assert.match(md, /every placed asset is its own group/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'export-demo.report.json'), 'utf8')).export.previewMatch, true);
});

test('library lists every asset with its real size once it is built', async () => {
  await buildItem({ slug: 'kit-test', profileId: 'generic' });
  const entries = await libraryEntries();
  const kit = entries.find((e) => e.slug === 'kit-test');
  assert.equal(kit.built, true);
  assert.equal(kit.size.meters.length, 3);
  assert.ok(kit.size.bounds.min[1] > -0.01, 'bounds are relative to the base-center origin');
  assert.deepEqual(kit.size.studs, kit.size.meters.map((v) => +(v / 0.28).toFixed(2)));
});

test('scene versions: save, skip when unchanged, restore with auto-save of unsaved work', () => {
  writeScene('versions-demo', scene());
  const first = saveSceneVersion('versions-demo', { note: 'first layout' });
  assert.equal(first.version.id, 'v001');
  assert.equal(saveSceneVersion('versions-demo', { note: 'again' }).skipped, true);
  const edited = scene();
  edited.instances.pop();
  writeScene('versions-demo', edited);
  assert.equal(sceneWorkingState('versions-demo').dirty, true);
  const restored = restoreSceneVersion('versions-demo', 'v001');
  assert.equal(restored.autosaved, 'v002');
  assert.equal(readScene('versions-demo').scene.instances.length, 4);
  assert.equal(sceneWorkingState('versions-demo').current, 'v001');
  assert.deepEqual(listSceneVersions('versions-demo').map((v) => [v.id, v.auto]), [['v001', false], ['v002', true]]);
  assert.throws(() => restoreSceneVersion('versions-demo', 'v009'), (err) => err.status === 404);
});

test('groups: schema, one node per group in the GLB, no overlap notes inside a group, layout', async () => {
  // No room, and the groups far apart (the fixture asset is several meters wide).
  const grouped = scene({
    room: null,
    instances: [
      { id: 'a-1', asset: 'kit-test', position: [0, 0, 0], group: 'set-1' },
      { id: 'a-2', asset: 'kit-test', position: [0.05, 0, 0.05], group: 'set-1' },
      { id: 'b-1', asset: 'fx-padding-ok', position: [0, 0, 20] },
      { id: 'a-3', asset: 'kit-test', position: [0, 0, 40], group: 'set-2' },
    ],
  });
  assert.deepEqual(normalizeScene(grouped).instances.map((inst) => inst.group), ['set-1', 'set-1', undefined, 'set-2']);
  expectSceneError(() => normalizeScene(scene({ instances: [{ id: 'a-1', asset: 'kit-test', group: 'Not Valid' }] })), 'instances[0].group');
  expectSceneError(() => normalizeScene(scene({ instances: [{ id: 'a-1', asset: 'kit-test', group: 'a-2' }, { id: 'a-2', asset: 'kit-test' }] })), 'instances');

  writeScene('group-demo', grouped);
  const { glb, report } = await composeScene({ name: 'group-demo', profileId: 'generic' });
  const doc = await createIO().readBinary(glb);
  const top = doc.getRoot().getDefaultScene().listChildren();
  assert.deepEqual(top.map((n) => n.getName()), ['set-1', 'b-1', 'set-2']);
  const set1 = top.find((n) => n.getName() === 'set-1');
  assert.deepEqual(set1.listChildren().map((n) => n.getName()), ['a-1', 'a-2']);
  assert.deepEqual(set1.getTranslation(), [0, 0, 0]);
  assert.equal(set1.getExtras().studio.role, 'group');
  assert.deepEqual(set1.listChildren()[1].getTranslation(), [0.05, 0, 0.05], 'members keep their own placement');
  // a-1 and a-2 sit on top of each other on purpose: no note. Loose instances still get one.
  assert.ok(!report.issues.some((i) => i.id === 'scene.overlap'), report.issues.map((i) => i.message).join('; '));
  const loose = structuredClone(grouped);
  delete loose.instances[1].group;
  writeScene('group-demo', loose);
  assert.ok((await composeScene({ name: 'group-demo', profileId: 'generic' })).report.issues.some((i) => i.id === 'scene.overlap'));

  writeScene('group-demo', grouped);
  const exported = await exportScene({ name: 'group-demo', profileId: 'generic' });
  assert.equal(exported.blocked, false, exported.reason);
  const layout = JSON.parse(fs.readFileSync(path.join(process.env.STUDIO_EXPORTS_DIR, 'generic', 'scenes', 'group-demo.layout.json'), 'utf8'));
  assert.deepEqual(layout.instances.map((inst) => inst.group), ['set-1', 'set-1', undefined, 'set-2']);
});
