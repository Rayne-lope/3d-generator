// Attachments (k.attach) and collision (k.collider, meta.collision): kit markers → IR →
// GLB empty nodes (generic) or setup files (Roblox), validation, and the generated Roblox
// setup module run in the Luau CLI against a stand-in API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { useFixtures, issueIds, ROOT } from './helpers.js';

useFixtures();
const { buildItem } = await import('../studio/core/build.js');
const { exportItem } = await import('../studio/core/export.js');
const { setupData, assetSetupLua, assetSetupCommand, setupRbxmx, hasSetup, luaValue } = await import('../studio/core/setup.js');
const { createIO } = await import('../studio/core/ir/to-gltf.js');
const { k, defineAsset, runAsset } = await import('../studio/kit/index.js');
const { sceneToIR } = await import('../studio/core/ir/from-three.js');

const near = (a, b, eps = 1e-4) => assert.ok(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps), `${JSON.stringify(a)} ≈ ${JSON.stringify(b)}`);
const STUDS = 25 / 7;

test('kit markers validate their input', () => {
  assert.throws(() => k.attach('1bad'), /invalid name/);
  assert.throws(() => k.attach('a', { at: [0, 0] }), /at must be \[x, y, z\]/);
  assert.throws(() => k.attach('a', { forward: [0, 0, 0] }), /forward must not be/);
  assert.throws(() => k.attach('a', { forward: [0, 1, 0], up: [0, 2, 0] }), /parallel/);
  assert.throws(() => k.collider.box(1, 0, 1), /height must be a number > 0/);
  assert.throws(() => k.collider.sphere(-1), /radius/);
  assert.throws(() => defineAsset({ meta: { title: 'x', collision: 'mesh' }, build: () => null }), /meta.collision/);
  const muzzle = k.attach('muzzle', { at: [1, 2, 3], forward: [1, 0, 0] });
  near(new THREE.Vector3(0, 0, 1).applyQuaternion(muzzle.quaternion).toArray(), [1, 0, 0]);
  near(new THREE.Vector3(0, 1, 0).applyQuaternion(muzzle.quaternion).toArray(), [0, 1, 0]);
});

test('markers follow their part: asset-space and node-local values, in meters and in studs', async () => {
  const { report } = await buildItem({ slug: 'fx-markers', profileId: 'generic' });
  assert.equal(report.collision, 'colliders');
  assert.deepEqual(report.attachments.map((a) => [a.name, a.node]), [['handle', 'body'], ['latch', 'lid']]);
  const latch = report.attachments[1];
  near(latch.position, [0, 0.55, 0.3]);
  near(latch.local.position, [0, 0.05, 0.6], 1e-5); // relative to the lid's pivot (0, 0.5, −0.3)
  near(report.attachments[0].forward, [1, 0, 0]);
  assert.deepEqual(report.colliders.map((c) => [c.name, c.shape, c.node]), [['collider-1', 'box', 'body'], ['bar', 'cylinder', 'body'], ['collider-3', 'sphere', 'lid']]);
  near(report.colliders[0].size, [1, 0.5, 0.6]);

  // An open lid carries its markers along; their local values do not change.
  const open = (await buildItem({ slug: 'fx-markers', variant: 'open', profileId: 'generic' })).report;
  near(open.attachments[1].local.position, [0, 0.05, 0.6], 1e-5);
  near(open.attachments[1].position, [0, 0.5 + 0.05 * Math.cos(0.5) + 0.6 * Math.sin(0.5), -0.3 - 0.05 * Math.sin(0.5) + 0.6 * Math.cos(0.5)], 1e-4);
  near(open.attachments[1].forward, [0, Math.sin(0.5), Math.cos(0.5)], 1e-5);

  const roblox = (await buildItem({ slug: 'fx-markers', profileId: 'roblox' })).report;
  near(roblox.attachments[1].position, [0, 0.55 * STUDS, 0.3 * STUDS], 1e-3);
  near(roblox.colliders[0].size, [STUDS, 0.5 * STUDS, 0.6 * STUDS], 1e-3);
  near(roblox.colliders[1].size, [0.1 * STUDS, 0.4 * STUDS], 1e-3);
});

test('generic GLBs carry markers as empty nodes; the Roblox GLB stays free of them', async () => {
  const generic = await buildItem({ slug: 'fx-markers', profileId: 'generic' });
  const doc = await createIO().readBinary(generic.glb);
  const nodes = doc.getRoot().listNodes();
  const byName = Object.fromEntries(nodes.map((n) => [n.getName(), n]));
  for (const name of ['handle', 'latch', 'collider-1', 'bar', 'collider-3']) assert.ok(byName[name] && !byName[name].getMesh(), `${name} is an empty node`);
  assert.deepEqual(byName.latch.getExtras().studio, { role: 'attachment' });
  assert.equal(byName.latch.getParentNode().getName(), 'lid');
  near(byName.latch.getTranslation(), [0, 0.05, 0.6], 1e-5);
  assert.deepEqual(byName.bar.getExtras().studio.shape, 'cylinder');
  near(byName.bar.getExtras().studio.size, [0.1, 0.4]);
  assert.equal(generic.report.counts.error, 0);
  assert.equal(generic.report.meshCount, 2, 'markers add no meshes');

  const roblox = await buildItem({ slug: 'fx-markers', profileId: 'roblox' });
  const rdoc = await createIO().readBinary(roblox.glb);
  assert.deepEqual(rdoc.getRoot().listNodes().map((n) => n.getName()).sort(), ['body', 'fx-markers', 'lid']);
  assert.equal(roblox.report.attachments.length, 2, 'the data is still in the report');
});

test('meta.collision: bounds box, none, and the conflicts that are rejected', async () => {
  const { report } = await buildItem({ slug: 'fx-bounds', profileId: 'generic' });
  assert.equal(report.collision, 'bounds');
  assert.equal(report.colliders.length, 1);
  near(report.colliders[0].size, [0.4, 0.8, 0.2]);
  near(report.colliders[0].position, [0, 0.4, 0]);

  const build = (meta, extra) => {
    const def = defineAsset({ meta: { title: 'x', ...meta }, build({ k: kit }) {
      const asset = kit.asset('x');
      asset.add(kit.mesh(kit.geo.box(1, 1, 1), kit.mat.pbr({ name: 'm' }), { at: [0, 0.5, 0] }));
      extra?.(kit, asset);
      return asset;
    } });
    return sceneToIR(runAsset(def).root, { slug: 'x', meta: def.meta });
  };
  assert.equal(build({ collision: 'none' }).collision, 'none');
  assert.equal(build({}).collision, 'default');
  assert.equal(build({}).colliders.length, 0);
  assert.throws(() => build({ collision: 'none' }, (kit, asset) => asset.add(kit.collider.sphere(0.5))), /meta.collision is 'none'/);
  // Explicit shapes win over the bounds shortcut.
  assert.equal(build({ collision: 'bounds' }, (kit, asset) => asset.add(kit.collider.sphere(0.5))).collision, 'colliders');
  // A squashed collider cannot be exported; a uniformly scaled one is resized.
  assert.throws(() => build({}, (kit, asset) => { const g = kit.group('g'); g.scale.set(1, 2, 1); g.add(kit.collider.sphere(0.5)); asset.add(g); }), /non-uniformly scaled/);
  const scaled = build({}, (kit, asset) => { const g = kit.group('g'); g.scale.setScalar(2); g.add(kit.collider.box(0.2, 0.2, 0.2, { at: [0, 0.25, 0] })); asset.add(g); });
  near(scaled.colliders[0].size, [0.4, 0.4, 0.4]);
  const twice = build({}, (kit, asset) => { asset.add(kit.attach('grip')); asset.add(kit.attach('grip')); });
  assert.ok(twice.issues.some((i) => i.id === 'attachment.duplicate-name' && i.severity === 'error'));
});

test('marker validation: a collider away from the asset warns; weapons are reminded of a grip', async () => {
  const far = (await buildItem({ slug: 'fx-markers', variant: 'far', profileId: 'generic' })).report;
  assert.ok(far.issues.some((i) => i.id === 'collider.outside-asset' && i.severity === 'warning' && i.where === 'collider-3'), issueIds(far).join(','));
  assert.deepEqual(issueIds((await buildItem({ slug: 'fx-markers', profileId: 'generic' })).report).filter((id) => id.startsWith('collider') || id.startsWith('attachment')), []);
  assert.ok(!issueIds((await buildItem({ slug: 'kit-test', profileId: 'generic' })).report).includes('attachment.weapon-grip'), 'only weapons get the grip reminder');
});

test('export writes setup.json everywhere and the AssetSetup module for Roblox', async () => {
  const roblox = await exportItem({ slug: 'fx-markers', profileId: 'roblox', parity: false });
  assert.equal(roblox.blocked, false, roblox.reason);
  const dir = path.join(process.env.STUDIO_EXPORTS_DIR, 'roblox');
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'fx-markers.setup.json'), 'utf8'));
  assert.equal(data.units.name, 'stud');
  near(data.size, [STUDS, 0.6 * STUDS, 0.6 * STUDS], 1e-3);
  assert.deepEqual(data.meshes.map((m) => m.node), ['body', 'lid']);
  near(data.colliders[1].y, [-1, 0, 0], 1e-5); // the bar's own Y axis lies along −X after rot z = 90°
  const rbxmx = fs.readFileSync(path.join(dir, 'fx-markers.setup.rbxmx'), 'utf8');
  assert.match(rbxmx, /<Item class="ModuleScript"/);
  assert.match(rbxmx, /<string name="Name">fx-markers setup<\/string>/);
  assert.match(rbxmx, /function AssetSetup\.apply\(model\)/);
  const md = fs.readFileSync(path.join(dir, 'fx-markers.report.md'), 'utf8');
  assert.match(md, /## Attachments and collision/);
  assert.match(md, /paste it into the command bar/);
  assert.match(md, /require\(folder\.AssetSetup\)\.apply\(model\)/);

  assert.match(md, /fx-markers\.setup\.lua/);
  // The command-bar version: one chunk without comments, next to the module.
  const command = fs.readFileSync(path.join(dir, 'fx-markers.setup.lua'), 'utf8');
  assert.ok(!command.split('\n').some((line) => line.trim().startsWith('--')), 'no comment lines');
  assert.match(command, /AssetSetup\.apply\(model\)\n$/);
  assert.match(setupRbxmx(data), /<string name="ScriptGuid">\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}<\/string>/);

  const generic = await exportItem({ slug: 'fx-markers', profileId: 'generic', parity: false });
  assert.ok(generic.files.setup && !generic.files.setupScript && !generic.files.setupCommand);
  assert.equal(fs.existsSync(path.join(process.env.STUDIO_EXPORTS_DIR, 'generic', 'fx-markers.setup.rbxmx')), false);
  // An asset without markers gets no setup files.
  const plain = await exportItem({ slug: 'kit-test', profileId: 'roblox', parity: false });
  assert.equal(plain.files.setup, undefined);
  assert.equal(hasSetup(plain.report), false);
  assert.equal(fs.existsSync(path.join(dir, 'kit-test.setup.json')), false);
  assert.equal(luaValue({ a: [1, 2], 'b-c': 'x', d: null }), '{\n\ta = { 1, 2 },\n\t["b-c"] = "x",\n\td = nil,\n}');
});

const luau = spawnSync('luau', ['--help'], { encoding: 'utf8' }).error ? null : 'luau';

test('AssetSetup runs in Luau: finds the import frame, places colliders and attachments, refuses a wrong size', { skip: luau ? false : 'luau is not installed' }, async () => {
  const { report } = await buildItem({ slug: 'fx-markers', variant: 'open', profileId: 'roblox' });
  const data = setupData(report);
  const mock = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'roblox', 'mock.luau'), 'utf8');
  const run = ({ importYaw, anchored, scale = 1 }) => {
    const source = `
local mock = (function()
${mock}
end)()
local Vector3, CFrame, Instance, Enum, typeof = mock.Vector3, mock.CFrame, mock.Instance, mock.Enum, mock.typeof
local AssetSetup = (function()
${assetSetupLua(data)}
end)()
local DATA = AssetSetup.data
local function v3(t) return Vector3.new(t[1], t[2], t[3]) end
-- The model sits somewhere in the place, turned 30 degrees; the importer turned it importYaw more.
local W = CFrame.new(10, 2, -5) * CFrame.Angles(0, math.rad(30), 0)
local turn = CFrame.Angles(0, math.rad(${importYaw}), 0)
local A = W * turn
local model = Instance.new("Model")
model.Name = DATA.item
for _, mesh in ipairs(DATA.meshes) do
	local part = Instance.new("MeshPart")
	part.Name = mesh.node
	part.CFrame = CFrame.new(A * v3(mesh.center))
	part.Anchored = ${anchored}
	part.Parent = model
end
local rs = turn:VectorToWorldSpace(v3(DATA.size))
model.Box = { cframe = CFrame.fromMatrix(A * v3(DATA.center), W.x, W.y, W.z), size = Vector3.new(math.abs(rs.X), math.abs(rs.Y), math.abs(rs.Z)) * ${scale} }
local ok, result = pcall(AssetSetup.apply, model)
if not ok then
	print("ERROR", result)
	return
end
AssetSetup.apply(model) -- a second run replaces the first
print("RESULT", result.yaw, result.colliders, result.attachments, result.matchedParts)
local folders = 0
for _, d in ipairs(model:GetDescendants()) do
	if d:IsA("Folder") then folders = folders + 1 end
	if d:IsA("Attachment") then
		local c = d.WorldCFrame
		print("ATT", d.Name, d.Parent.Name, c.Position.X, c.Position.Y, c.Position.Z, c.LookVector.X, c.LookVector.Y, c.LookVector.Z)
	elseif d:IsA("Part") then
		print("COL", d.Name, d.Shape, d.Size.X, d.Size.Y, d.Size.Z, d.CFrame.Position.X, d.CFrame.Position.Y, d.CFrame.Position.Z, tostring(d.CanCollide), tostring(d.Anchored), tostring(d:FindFirstChild("WeldConstraint") ~= nil), d.CFrame.x.X, d.CFrame.x.Y, d.CFrame.x.Z)
	elseif d:IsA("MeshPart") then
		print("MESH", d.Name, tostring(d.CanCollide))
	end
end
print("FOLDERS", folders)
`;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-luau-')), 'run.luau');
    fs.writeFileSync(file, source);
    const out = execFileSync(luau, [file], { encoding: 'utf8' });
    const rows = out.trim().split('\n').map((line) => line.split('\t'));
    const num = (list) => list.map(Number);
    return {
      error: rows.find((r) => r[0] === 'ERROR')?.[1] || null,
      result: rows.find((r) => r[0] === 'RESULT')?.slice(1).map(Number) || null,
      folders: Number(rows.find((r) => r[0] === 'FOLDERS')?.[1]),
      attachments: Object.fromEntries(rows.filter((r) => r[0] === 'ATT').map((r) => [r[1], { parent: r[2], position: num(r.slice(3, 6)), look: num(r.slice(6, 9)) }])),
      colliders: Object.fromEntries(rows.filter((r) => r[0] === 'COL').map((r) => [r[1], { shape: r[2], size: num(r.slice(3, 6)), position: num(r.slice(6, 9)), canCollide: r[9], anchored: r[10], welded: r[11], xAxis: num(r.slice(12, 15)) }])),
      meshes: Object.fromEntries(rows.filter((r) => r[0] === 'MESH').map((r) => [r[1], r[2]])),
    };
  };
  // The truth the script has to recover: world = W * Ry(importYaw) * assetPoint.
  const world = (importYaw) => new THREE.Matrix4().makeTranslation(10, 2, -5).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 6)).multiply(new THREE.Matrix4().makeRotationY((importYaw * Math.PI) / 180));
  for (const importYaw of [0, 180]) {
    const out = run({ importYaw, anchored: 'true' });
    assert.equal(out.error, null);
    assert.deepEqual(out.result, [importYaw, 3, 2, 2], `yaw ${importYaw}: turn found, 3 colliders, 2 attachments, both mesh parts matched`);
    assert.equal(out.folders, 1, 'running twice leaves one Collision folder');
    const A = world(importYaw);
    for (const a of data.attachments) {
      const got = out.attachments[a.name];
      assert.equal(got.parent, a.node);
      near(got.position, new THREE.Vector3(...a.position).applyMatrix4(A).toArray(), 1e-3);
      near(got.look, new THREE.Vector3(...a.forward).transformDirection(A).toArray(), 1e-3);
    }
    for (const c of data.colliders) {
      const got = out.colliders[c.name];
      near(got.position, new THREE.Vector3(...c.position).applyMatrix4(A).toArray(), 1e-3);
      assert.deepEqual([got.canCollide, got.anchored, got.welded], ['true', 'true', 'false']);
    }
    near(out.colliders['collider-1'].size, data.colliders[0].size, 1e-4);
    assert.equal(out.colliders['collider-3'].shape, 'Ball');
    near(out.colliders['collider-3'].size, [0.05 * STUDS * 2, 0.05 * STUDS * 2, 0.05 * STUDS * 2], 1e-3);
    // Cylinder: length along the part's X axis, which must be the exported cylinder's own Y axis.
    const bar = data.colliders[1];
    assert.equal(out.colliders.bar.shape, 'Cylinder');
    near(out.colliders.bar.size, [bar.size[1], bar.size[0] * 2, bar.size[0] * 2], 1e-4);
    near(out.colliders.bar.xAxis, new THREE.Vector3(...bar.y).transformDirection(A).toArray(), 1e-3);
    assert.deepEqual(out.meshes, { body: 'false', lid: 'false' }, 'visual parts stop colliding');
  }
  // Unanchored models get their colliders welded to the part they belong to.
  const loose = run({ importYaw: 0, anchored: 'false' });
  assert.deepEqual([loose.colliders.bar.anchored, loose.colliders.bar.welded], ['false', 'true']);
  // Imported at the wrong scale (meters read as studs): refuse, with a hint.
  const wrong = run({ importYaw: 0, anchored: 'true', scale: STUDS });
  assert.match(wrong.error, /Scale Unit = Stud/);
});

test('the command-bar version runs as one pasted chunk, even with its lines joined', { skip: luau ? false : 'luau is not installed' }, async () => {
  const { report } = await buildItem({ slug: 'fx-markers', profileId: 'roblox' });
  const data = setupData(report);
  const mock = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'roblox', 'mock.luau'), 'utf8');
  const run = (command, selectModel) => {
    const source = `
local mock = (function()
${mock}
end)()
local Vector3, CFrame, Instance, Enum, typeof = mock.Vector3, mock.CFrame, mock.Instance, mock.Enum, mock.typeof
local DATA = ${luaValue({ size: data.size, center: data.bounds.center, meshes: data.meshes.map((m) => ({ node: m.node, center: m.center })) })}
local function v3(t) return Vector3.new(t[1], t[2], t[3]) end
local model = Instance.new("Model")
model.Name = ${JSON.stringify(data.item)}
for _, mesh in ipairs(DATA.meshes) do
	-- Like the Roblox importer: a Model "<node>_Node" holding the MeshPart "<node>".
	local holder = Instance.new("Model")
	holder.Name = mesh.node .. "_Node"
	holder.Parent = model
	local part = Instance.new("MeshPart")
	part.Name = mesh.node
	part.CFrame = CFrame.new(v3(mesh.center))
	part.Parent = holder
end
model.Box = { cframe = CFrame.new(v3(DATA.center)), size = v3(DATA.size) }
local workspace = { FindFirstChild = function(_, name) return name == model.Name and model or nil end }
local game = { GetService = function() return { Get = function() return ${selectModel ? '{ model }' : '{}'} end } end }
${command}
`;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-luau-')), 'command.luau');
    fs.writeFileSync(file, source);
    return execFileSync(luau, [file], { encoding: 'utf8' }).trim();
  };
  const command = assetSetupCommand(data);
  const expected = 'AssetSetup(fx-markers): 3 collider(s), 2 attachment(s); model turned 0 deg, 2 of 2 mesh part(s) matched';
  assert.equal(run(command, false), expected, 'finds the model by name in Workspace');
  assert.equal(run(command, true), expected, 'or uses the selected Model');
  assert.equal(run(command.replace(/\n/g, ' '), true), expected, 'still valid when the command bar joins the lines');
});
