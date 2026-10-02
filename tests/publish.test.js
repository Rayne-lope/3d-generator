import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { useFixtures } from './helpers.js';

useFixtures();
const { createClient, loadCredentials, parseCreator, readDotEnv, OpenCloudError } = await import('../studio/core/roblox-cloud.js');
const { publishRoblox, readRegistry, skinsRbxmx } = await import('../studio/core/publish.js');

const KEY = 'test-key-SECRET-123';

// A tiny fake of the Open Cloud Assets API: multipart create, PATCH update, operations.
function fakeOpenCloud() {
  const calls = [];
  const ops = new Map();
  let nextAsset = 1000;
  let nextOp = 1;
  let throttleOnce = true;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const body = Buffer.concat(chunks);
    const send = (status, data, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(data));
    };
    if (req.headers['x-api-key'] !== KEY) return send(401, { message: 'Invalid API key' });
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname.startsWith('/assets/v1/operations/')) {
      const op = ops.get(url.pathname.split('/').pop());
      calls.push({ method: 'GET', path: url.pathname });
      return op ? send(200, { ...op, done: true }) : send(404, { message: 'operation not found' });
    }
    if ((req.method === 'POST' && url.pathname === '/assets/v1/assets') || (req.method === 'PATCH' && url.pathname.startsWith('/assets/v1/assets/'))) {
      const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body }).formData();
      const request = JSON.parse(form.get('request'));
      const file = form.get('fileContent');
      const bytes = new Uint8Array(await file.arrayBuffer());
      calls.push({ method: req.method, path: url.pathname, request, contentType: file.type, name: file.name, size: bytes.byteLength });
      if (req.method === 'POST' && request.assetType === 'Image' && throttleOnce) {
        throttleOnce = false;
        calls.pop();
        return send(429, { message: 'Too many requests' }, { 'retry-after': '0' });
      }
      const assetId = req.method === 'PATCH' ? url.pathname.split('/').pop() : String(nextAsset++);
      const opId = `op${nextOp++}`;
      const response = { path: `assets/${assetId}`, assetId, revisionId: req.method === 'PATCH' ? '2' : '1', displayName: request.displayName, moderationResult: { moderationState: 'MODERATION_STATE_APPROVED' } };
      ops.set(opId, { path: `operations/${opId}`, operationId: opId, response });
      // Creates finish later (polled); updates finish at once.
      return send(200, req.method === 'PATCH' ? { path: `operations/${opId}`, operationId: opId, done: true, response } : { path: `operations/${opId}`, operationId: opId, done: false });
    }
    return send(404, { message: 'not found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

const fake = await fakeOpenCloud();
after(() => fake.server.close());
const client = () => createClient({ apiKey: KEY, baseUrl: fake.url, sleep: async () => {}, minInterval: 0 });

test('credentials come from the environment or .env, never from code', () => {
  assert.deepEqual(parseCreator('user:42'), { userId: '42' });
  assert.deepEqual(parseCreator('group:7'), { groupId: '7' });
  assert.deepEqual(parseCreator('99'), { userId: '99' });
  assert.throws(() => parseCreator('bob'), /user:123 or group:456/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-env-'));
  fs.writeFileSync(path.join(dir, '.env'), '# comment\nROBLOX_API_KEY="abc def"\nexport ROBLOX_CREATOR=group:55 # trailing\n');
  assert.deepEqual(readDotEnv(path.join(dir, '.env')), { ROBLOX_API_KEY: 'abc def', ROBLOX_CREATOR: 'group:55' });
  const fromFile = loadCredentials({ env: {}, root: dir });
  assert.equal(fromFile.apiKey, 'abc def');
  assert.deepEqual(fromFile.creator, { groupId: '55' });
  assert.deepEqual(fromFile.sources, { apiKey: '.env', creator: '.env' });
  const fromEnv = loadCredentials({ env: { ROBLOX_API_KEY: 'k', ROBLOX_CREATOR: 'user:1' }, root: dir, group: '9' });
  assert.equal(fromEnv.apiKey, 'k');
  assert.deepEqual(fromEnv.creator, { groupId: '9' }, '--group overrides ROBLOX_CREATOR');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('publish uploads the model and every skin map once, then writes an insertable rbxmx', async () => {
  const results = await publishRoblox({ items: [{ slug: 'fx-skins-ok', variant: null }], creator: { userId: '42' }, client: client(), skins: true });
  const [r] = results;
  assert.deepEqual(r.problems, []);
  assert.equal(r.model.action, 'create');
  const model = fake.calls.find((c) => c.method === 'POST' && c.request.assetType === 'Model');
  assert.equal(model.contentType, 'model/gltf-binary');
  assert.deepEqual(model.request.creationContext, { creator: { userId: '42' } });
  assert.equal(model.request.displayName, 'Skins Test OK');
  assert.ok(fake.calls.some((c) => c.method === 'GET' && c.path.startsWith('/assets/v1/operations/')), 'creates are polled until done');
  const images = fake.calls.filter((c) => c.method === 'POST' && c.request.assetType === 'Image');
  assert.ok(images.length >= 4, `images uploaded: ${images.length}`);
  assert.ok(images.every((c) => c.contentType === 'image/png'));
  assert.equal(r.skins.images.created, images.length, 'each distinct map is uploaded exactly once (a 429 was retried)');
  assert.equal(r.skins.images.created + r.skins.images.reused, r.skins.images.total);
  // The rbxmx: well-formed, one SurfaceAppearance per MeshPart per look, ids from the uploads.
  const xmlText = fs.readFileSync(path.join(process.env.STUDIO_EXPORTS_DIR, 'roblox', 'fx-skins-ok.skins.rbxmx'), 'utf8');
  assertBalanced(xmlText);
  assert.match(xmlText, /<Item class="ModuleScript"[^>]*>\s*<Properties>\s*<string name="Name">SkinSwitcher<\/string>/);
  assert.equal((xmlText.match(/class="SurfaceAppearance"/g) || []).length, 2 * 2, '2 looks × 2 MeshParts');
  const ids = new Set([...xmlText.matchAll(/rbxassetid:\/\/(\d+)/g)].map((m) => m[1]));
  for (const id of ids) assert.ok(Number(id) >= 1000, `uses uploaded ids (${id})`);
  const reg = readRegistry();
  assert.equal(reg.items['fx-skins-ok'].assetId, r.model.assetId);
  assert.ok(!JSON.stringify(reg).includes(KEY), 'the API key is never stored');
  const pub = fs.readFileSync(path.join(process.env.STUDIO_EXPORTS_DIR, 'roblox', 'fx-skins-ok.publish.json'), 'utf8');
  assert.ok(!pub.includes(KEY));
  assert.match(pub, /InsertService/);
});

test('publishing again skips unchanged files; --force uploads a new model version (PATCH)', async () => {
  const before = fake.calls.length;
  const [again] = await publishRoblox({ items: [{ slug: 'fx-skins-ok', variant: null }], creator: { userId: '42' }, client: client(), skins: true });
  assert.equal(again.model.action, 'unchanged');
  assert.equal(again.skins.images.created, 0);
  assert.equal(fake.calls.length, before, 'no request at all when nothing changed');
  const [forced] = await publishRoblox({ items: [{ slug: 'fx-skins-ok', variant: null }], creator: { userId: '42' }, client: client(), force: true });
  assert.equal(forced.model.action, 'update');
  const patch = fake.calls.at(-1);
  assert.equal(patch.method, 'PATCH');
  assert.equal(patch.path, `/assets/v1/assets/${forced.model.assetId}`);
  assert.deepEqual(patch.request, { assetId: forced.model.assetId });
  // Another creator cannot update this asset: it gets its own.
  const [group] = await publishRoblox({ items: [{ slug: 'fx-skins-ok', variant: null }], creator: { groupId: '7' }, client: client() });
  assert.equal(group.model.action, 'create');
  assert.notEqual(group.model.assetId, forced.model.assetId);
});

test('API errors explain the fix and never contain the key; oversize files fail before uploading', async () => {
  const bad = createClient({ apiKey: 'wrong-key', baseUrl: fake.url, sleep: async () => {}, minInterval: 0 });
  await assert.rejects(
    bad.createAsset({ assetType: 'Model', displayName: 'x', creator: { userId: '1' }, file: { bytes: new Uint8Array(4), name: 'x.glb', contentType: 'model/gltf-binary' } }),
    (err) => err instanceof OpenCloudError && err.status === 401 && /API key/.test(err.message) && !err.message.includes('wrong-key'),
  );
  await assert.rejects(
    client().createAsset({ assetType: 'Model', displayName: 'big', creator: { userId: '1' }, file: { bytes: new Uint8Array(21 * 1024 * 1024), name: 'big.glb', contentType: 'model/gltf-binary' } }),
    /20 MB/,
  );
  assert.throws(() => createClient({ apiKey: '' }), /ROBLOX_API_KEY/);
});

test('rbxmx escapes names and refuses maps that were not uploaded', () => {
  const text = skinsRbxmx({ id: 'a&b', looks: ['default'], surfaceAppearances: { default: { 'body<1>': { alphaMode: 'MASK', ColorMap: 'default/c.png' } } }, imageIds: { 'default/c.png': '55' } });
  assertBalanced(text);
  assert.match(text, /a&amp;b skins/);
  assert.match(text, /body&lt;1&gt;/);
  assert.match(text, /<token name="AlphaMode">1<\/token>/);
  assert.throws(() => skinsRbxmx({ id: 'x', looks: ['default'], surfaceAppearances: { default: { body: { ColorMap: 'nope.png' } } }, imageIds: {} }), /no uploaded image/);
});

/** Balanced tags outside CDATA (enough to catch broken XML from string building). */
function assertBalanced(text) {
  const stripped = text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const stack = [];
  for (const m of stripped.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , selfClose] = m;
    if (selfClose) continue;
    if (close) assert.equal(stack.pop(), name, `closing </${name}>`);
    else stack.push(name);
  }
  assert.deepEqual(stack, [], 'every tag is closed');
}
