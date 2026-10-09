// Local studio server: serves the viewport, preview GLBs and a small JSON API, watches
// asset sources and rebuilds them in child processes, and pushes reload events (SSE).
// Binds to 127.0.0.1 only.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths, previewReport, itemId, ROOT } from '../core/paths.js';
import { readJson, writeJson, ensureDir, hashDirs } from '../core/fsutil.js';
import { listAssets, listSets, loadSet, setOfAsset } from '../core/targets.js';
import { listProfiles, loadProfile } from '../profiles/index.js';
import { loadConfig } from '../core/config.js';
import { EditorError, editorData, editorRevision, replaceEditorScope, assertEditorSlug } from '../core/editor.js';
import { computeSourceHash } from '../core/build.js';
import { loadAssetDef } from '../core/load-asset.js';
import { editorControls, editorParts } from '../kit/editor.js';
import { SceneError, assertSceneName, createScene, listScenes as listSceneNames, readScene, sceneExists, sceneRevision, writeScene } from '../scene/schema.js';
import { libraryEntries, thumbFiles, thumbUrl } from '../scene/library.js';
import { listSceneVersions, sceneWorkingState } from '../scene/snapshots.js';
import { scenePaths, sceneReport } from '../scene/paths.js';
import { buildShell } from '../scene/shell.js';
import { parseItemId } from '../core/paths.js';
import { writeFileAtomic } from '../core/fsutil.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8',
};

// URL prefix → directory. Only these trees are served.
const MOUNTS = [
  ['/viewport/', path.join(ROOT, 'studio', 'viewport')],
  ['/studio/kit/', path.join(ROOT, 'studio', 'kit')],
  ['/assets/', paths.assets],
  ['/sets/', paths.sets],
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/vendor/three-mesh-bvh/', path.join(ROOT, 'node_modules', 'three-mesh-bvh')],
  ['/vendor/three-bvh-csg/', path.join(ROOT, 'node_modules', 'three-bvh-csg')],
  ['/files/preview/', paths.preview],
  ['/files/history/', paths.history],
  ['/files/shots/', paths.shots],
  ['/files/exports/', paths.exports],
  ['/files/engines/', paths.engines],
  ['/files/scenes/', scenePaths.state],
  ['/files/thumbs/', scenePaths.thumbs],
];

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on('data', (chunk) => {
      if (exceeded) return;
      size += chunk.byteLength;
      if (size > limit) {
        exceeded = true;
        reject(new EditorError('request body too large', 413));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const data = Buffer.concat(chunks).toString('utf8');
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(new EditorError('invalid JSON body', 400));
      }
    });
    req.on('error', reject);
  });
}

function requireLocal(req, contentType = /^application\/json(?:\s*;|$)/i, label = 'application/json') {
  const host = req.headers.host || '';
  let local;
  try { local = new URL(`http://${host}`); } catch { throw new EditorError('local host required', 403); }
  const hostname = local.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) throw new EditorError('local host required', 403);
  if (req.headers.origin && req.headers.origin !== local.origin) throw new EditorError('same origin required', 403);
  if (!contentType.test(req.headers['content-type'] || '')) throw new EditorError(`${label} required`, 415);
}

function requireLocalJson(req) {
  requireLocal(req);
}

/** Raw request body up to `limit` bytes (thumbnail uploads). */
function readBinary(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on('data', (chunk) => {
      if (exceeded) return;
      size += chunk.byteLength;
      if (size > limit) {
        exceeded = true;
        reject(new EditorError('request body too large', 413));
      } else chunks.push(chunk);
    });
    req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

const SCENE_BODY_LIMIT = 2 * 1024 * 1024;
const THUMB_LIMIT = 400 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function runJsonCli(args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'studio', 'index.js'), ...args, '--json'], { cwd: ROOT, env: { ...process.env, STUDIO_NO_NOTIFY: '1' } });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(data);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new EditorError('operation timed out', 504)); }, timeoutMs);
    child.stdout.on('data', (data) => { stdout += data; if (stdout.length > 2e6) { child.kill('SIGKILL'); finish(new EditorError('operation output too large', 500)); } });
    child.stderr.on('data', (data) => { stderr += data; if (stderr.length > 2e6) { child.kill('SIGKILL'); finish(new EditorError('operation output too large', 500)); } });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      let parsed;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = null; }
      if (code !== 0 && !parsed) finish(new EditorError(stderr.trim().split('\n').slice(-4).join('\n') || 'operation failed', 500));
      else finish(null, parsed || { error: stderr.trim() || 'operation failed', exitCode: code });
    });
  });
}

/** Serve one mounted path (or 404). Returns true when handled. */
function serveMounted(p, res) {
  if (p === '/' || p === '/index.html') {
    serveFile(res, path.join(ROOT, 'studio', 'viewport', 'index.html'));
    return true;
  }
  if (p === '/capture' || p === '/capture.html') {
    serveFile(res, path.join(ROOT, 'studio', 'viewport', 'capture.html'));
    return true;
  }
  for (const [prefix, dir] of MOUNTS) {
    if (p.startsWith(prefix)) {
      const file = path.normalize(path.join(dir, p.slice(prefix.length)));
      if (!file.startsWith(dir)) send(res, 403, { error: 'forbidden' });
      else serveFile(res, file);
      return true;
    }
  }
  return false;
}

/** Static-only server (no API, no watchers) for headless captures. */
export async function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!serveMounted(decodeURIComponent(url.pathname), res)) send(res, 404, { error: 'not found' });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) };
}

async function assetSummaries() {
  const { loadAssetDef } = await import('../core/load-asset.js');
  const out = [];
  for (const slug of listAssets()) {
    // Read meta through a child-free path: parse the module in-process once per request is
    // fine for metadata, but modules are cached by Node — so we read meta from the last report
    // when available and fall back to importing.
    let meta = null;
    let variants = [];
    let skins = [];
    const report = readJson(previewReport(slug, null, 'generic'), null);
    if (report) {
      meta = { title: report.title, category: report.category, style: report.style, set: report.set, prompt: report.prompt };
    }
    try {
      const fresh = await import(`../../assets/${slug}/asset.js?t=${fs.statSync(path.join(paths.assets, slug, 'asset.js')).mtimeMs}`);
      const def = fresh.default;
      meta = { title: def.meta.title, category: def.meta.category, style: def.meta.style, set: def.meta.set || null, prompt: def.meta.prompt || '' };
      variants = Object.keys(def.variants || {});
      skins = Object.keys(def.skins || {});
    } catch {
      try {
        const def = await loadAssetDef(slug);
        variants = Object.keys(def.variants || {});
        skins = Object.keys(def.skins || {});
      } catch {
        // broken module: still list it so the viewport can show the error
      }
    }
    const profiles = {};
    for (const p of listProfiles()) {
      const r = readJson(previewReport(slug, null, p), null);
      if (r) profiles[p] = { ok: r.ok, counts: r.counts, triangles: r.triangles.total, builtAt: r.builtAt };
    }
    out.push({ slug, ...(meta || { title: slug }), variants, skins, profiles, thumb: thumbUrl(slug, report?.hashes?.glb), glbHash: report?.hashes?.glb || null });
  }
  return out;
}

export async function startServer({ port, host = '127.0.0.1' } = {}) {
  const config = loadConfig();
  const listenPort = port ?? config.server.port;
  // This process keeps the studio's code in memory (kit version, hashing, validation). When the
  // code on disk changes, its idea of "current preview" no longer matches what builds produce,
  // so the viewport is told to ask for a restart instead of showing previews as stale forever.
  const codeDirs = [paths.kit, path.join(ROOT, 'studio', 'core'), paths.profiles, path.join(ROOT, 'studio', 'server'), path.join(ROOT, 'studio', 'cli'), scenePaths.code];
  const bootCode = hashDirs(codeDirs);
  const clients = new Set();
  const activeProfiles = new Set(['generic']);
  const queue = [];
  let running = null;
  const lastErrors = new Map();
  // The look (variant/skin) the viewport shows per asset, rebuilt along with the base on edits.
  const activeLook = new Map();
  const assetOperations = new Map();
  const withAssetOperation = (slug, fn) => {
    const prior = assetOperations.get(slug) || Promise.resolve();
    const next = prior.catch(() => {}).then(fn);
    assetOperations.set(slug, next);
    next.finally(() => { if (assetOperations.get(slug) === next) assetOperations.delete(slug); }).catch(() => {});
    return next;
  };
  const editorPayload = async (slug, { variant = null, skin = null, profile = 'generic' } = {}) => {
    if (!listProfiles().includes(profile)) throw new EditorError(`unknown profile '${profile}'`, 400, 'profile');
    const data = await editorData(slug, { variant, skin, profile });
    const def = await loadAssetDef(slug);
    const sourceHash = computeSourceHash(slug, variant, profile, def.meta.set || setOfAsset(slug), skin);
    const report = readJson(previewReport(slug, variant, profile, skin), null);
    if (editorRevision(slug) !== data.revision) throw new EditorError('source changed while reading editor state', 409);
    return { ...data, preview: { current: !!report && report.hashes?.source === sourceHash, sourceHash: report?.hashes?.source || null } };
  };
  const requireEditableAsset = async (slug) => {
    const def = await loadAssetDef(slug);
    if (!editorControls(def).length && !editorParts(def).length) throw new EditorError(`asset '${slug}' is not enabled for visual editing`, 403);
    return def;
  };
  const scenePayload = (name, profile = 'generic') => {
    if (!listProfiles().includes(profile)) throw new EditorError(`unknown profile '${profile}'`, 400, 'profile');
    const data = readScene(name);
    const report = readJson(sceneReport(name, profile), null);
    return {
      ...data,
      profile,
      report,
      preview: { current: !!report && report.hashes?.scene === data.revision, url: report?.file ? `/files/scenes/${name}/${profile}.glb` : null },
      history: sceneWorkingState(name),
      versions: listSceneVersions(name),
    };
  };
  const requireScene = (name) => {
    assertSceneName(name);
    if (!sceneExists(name)) throw new SceneError(`scene '${name}' not found`, 404);
  };
  /** One placeable item (asset + variant + skin) for the composer: a current preview GLB and its size in meters. */
  const sceneItem = async (slug, variant, skin, profile) => {
    assertEditorSlug(slug);
    if (!listProfiles().includes(profile)) throw new EditorError(`unknown profile '${profile}'`, 400, 'profile');
    const def = await loadAssetDef(slug);
    if (variant && !Object.hasOwn(def.variants, variant)) throw new EditorError(`unknown variant '${variant}'`, 404, 'variant');
    if (skin && !Object.hasOwn(def.skins || {}, skin)) throw new EditorError(`unknown skin '${skin}'`, 404, 'skin');
    const expected = () => computeSourceHash(slug, variant, profile, def.meta.set || setOfAsset(slug), skin);
    let report = readJson(previewReport(slug, variant, profile, skin), null);
    let error = null;
    if (!report || report.hashes?.source !== expected()) {
      const result = await enqueue(slug, variant, profile, skin);
      error = result.error || null;
      report = readJson(previewReport(slug, variant, profile, skin), null);
    }
    if (!report) return { item: itemId(slug, variant, skin), slug, variant, skin, profile, error: error || 'no preview' };
    const perMeter = report.profile.units.perMeter;
    return {
      item: itemId(slug, variant, skin), slug, variant, skin, profile, title: report.title,
      url: `/files/preview/${itemId(slug, variant, skin)}/${profile}.glb`,
      glbHash: report.hashes.glb,
      bounds: { min: report.bounds.min.map((v) => v / perMeter), max: report.bounds.max.map((v) => v / perMeter) },
      meters: report.dimensions.meters, triangles: report.triangles.total, meshes: report.meshCount,
      ok: report.counts.error === 0, errors: report.counts.error, warnings: report.counts.warning, error,
    };
  };
  const noteLook = (slug, variant, skin) => {
    if (slug) activeLook.set(slug, { variant: variant || null, skin: skin || null });
  };

  const broadcast = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const runBuild = (job) => new Promise((resolve) => {
    const args = [path.join(ROOT, 'studio', 'index.js'), 'build', job.slug, '--profile', job.profile, '--json'];
    if (job.variant) args.push('--variant', job.variant);
    else args.push('--variant', 'base');
    if (job.skin) args.push('--skin', job.skin);
    broadcast('build-start', { slug: job.slug, variant: job.variant || null, skin: job.skin || null, profile: job.profile, revision: job.revision });
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, STUDIO_NO_NOTIFY: '1' } });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 60000);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => { stderr += err.message; });
    child.on('close', () => {
      clearTimeout(timer);
      let result = { slug: job.slug, variant: job.variant || null, skin: job.skin || null, profile: job.profile, revision: job.revision, ok: false };
      try {
        const parsed = JSON.parse(stdout.slice(stdout.indexOf('{')));
        const r = parsed.results?.[0];
        if (r) result = { ...result, ok: r.ok, counts: r.counts, error: r.error || null, cached: r.cached };
      } catch {
        result.error = timedOut ? 'build timed out after 60 seconds' : (stderr || stdout).trim().split('\n').slice(-6).join('\n') || 'build failed';
      }
      try { if (editorRevision(job.slug) !== job.revision) return resolve({ ...result, stale: true }); } catch {}
      const key = `${itemId(job.slug, job.variant, job.skin)}|${job.profile}`;
      if (result.error) lastErrors.set(key, result.error);
      else lastErrors.delete(key);
      broadcast('built', result);
      resolve(result);
    });
  });

  const pump = async () => {
    if (running || !queue.length) return;
    const job = queue.shift();
    running = job;
    const result = await runBuild(job);
    if (result.stale) {
      let latest;
      try { latest = editorRevision(job.slug); } catch { latest = null; }
      if (latest) {
        const queued = queue.find((j) => j.slug === job.slug && j.variant === job.variant && j.skin === job.skin && j.profile === job.profile);
        if (queued) { queued.revision = latest; queued.waiters.push(...job.waiters); }
        else queue.unshift({ ...job, revision: latest });
      } else for (const w of job.waiters) w(result);
      running = null;
      pump();
      return;
    }
    for (const w of job.waiters) w(result);
    running = null;
    pump();
  };

  const enqueue = (slug, variant, profile, skin = null) => new Promise((resolve) => {
    let revision;
    try { revision = editorRevision(slug); } catch (err) { resolve({ slug, variant, skin, profile, ok: false, error: err.message }); return; }
    if (running && running.slug === slug && running.variant === variant && running.skin === skin && running.profile === profile && running.revision === revision) {
      running.waiters.push(resolve);
      return;
    }
    const existing = queue.find((j) => j.slug === slug && j.variant === variant && j.skin === skin && j.profile === profile);
    if (existing) { existing.revision = revision; existing.waiters.push(resolve); }
    else queue.push({ slug, variant, skin, profile, revision, waiters: [resolve] });
    pump();
  });

  // Watch sources: assets/<slug>/** and sets/<set>/** (a set change rebuilds its members).
  const timers = new Map();
  const schedule = (slug) => {
    clearTimeout(timers.get(slug));
    timers.set(slug, setTimeout(() => {
      timers.delete(slug);
      const look = activeLook.get(slug);
      for (const profile of activeProfiles) {
        enqueue(slug, null, profile);
        if (look && (look.variant || look.skin)) enqueue(slug, look.variant, profile, look.skin);
      }
    }, 250));
  };
  const watchers = [];
  for (const [dir, kind] of [[paths.assets, 'asset'], [paths.sets, 'set']]) {
    ensureDir(dir);
    try {
      watchers.push(fs.watch(dir, { recursive: true }, (_evt, file) => {
        if (!file) return;
        const top = String(file).split(/[\\/]/)[0];
        if (kind === 'asset') {
          if (fs.existsSync(path.join(paths.assets, top, 'asset.js'))) schedule(top);
        } else {
          try {
            for (const m of loadSet(top).members) schedule(m);
          } catch {
            // not a set folder (yet)
          }
        }
      }));
    } catch (err) {
      console.warn(`watch disabled for ${dir}: ${err.message}`);
    }
  }

  // Watch scenes/<name>/scene.json: edits by an agent or the CLI reach the composer at once.
  const sceneTimers = new Map();
  ensureDir(scenePaths.scenes);
  try {
    watchers.push(fs.watch(scenePaths.scenes, { recursive: true }, (_evt, file) => {
      if (!file) return;
      const name = String(file).split(/[\\/]/)[0];
      clearTimeout(sceneTimers.get(name));
      sceneTimers.set(name, setTimeout(() => {
        sceneTimers.delete(name);
        let revision = null;
        try { if (sceneExists(name)) revision = sceneRevision(name); } catch {}
        broadcast('scene-changed', { name, revision });
      }, 150));
    }));
  } catch (err) {
    console.warn(`watch disabled for ${scenePaths.scenes}: ${err.message}`);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = decodeURIComponent(url.pathname);
    let requestSlug = null;
    let requestLook = {};
    let requestScene = null;
    try {
      if (p === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: hello\ndata: {}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      if (p === '/api/state') {
        return send(res, 200, {
          assets: await assetSummaries(),
          sets: listSets().map((n) => loadSet(n)),
          profiles: listProfiles().map((id) => ({ id, label: loadProfile(id).label, units: loadProfile(id).units })),
          config,
          codeChanged: hashDirs(codeDirs) !== bootCode,
          building: running ? { slug: running.slug, variant: running.variant || null, skin: running.skin || null, profile: running.profile, revision: running.revision } : null,
        });
      }
      if (p === '/api/report') {
        const slug = url.searchParams.get('slug');
        const variant = url.searchParams.get('variant') || null;
        const skin = url.searchParams.get('skin') || null;
        const profile = url.searchParams.get('profile') || 'generic';
        if (listProfiles().includes(profile)) activeProfiles.add(profile);
        noteLook(slug, variant, skin);
        const report = readJson(previewReport(slug, variant, profile, skin), null);
        const error = lastErrors.get(`${itemId(slug, variant, skin)}|${profile}`) || null;
        return send(res, report || error ? 200 : 404, { report, error });
      }
      if (p === '/api/history') {
        const slug = url.searchParams.get('slug');
        const { versionsForAsset } = await import('../core/history.js');
        return send(res, 200, { versions: versionsForAsset(slug, url.searchParams.get('variant') || null) });
      }
      if (p === '/api/editor' && req.method === 'GET') {
        const slug = url.searchParams.get('slug');
        requestSlug = slug;
        requestLook = { variant: url.searchParams.get('variant') || null, skin: url.searchParams.get('skin') || null, profile: url.searchParams.get('profile') || 'generic' };
        return send(res, 200, await editorPayload(slug, requestLook));
      }
      if (p === '/api/editor' && req.method === 'PUT') {
        requireLocalJson(req);
        const body = await readBody(req);
        requestSlug = body.slug;
        requestLook = { variant: body.variant || null, profile: body.profile || 'generic' };
        assertEditorSlug(body.slug);
        if (body.variant != null && typeof body.variant !== 'string') throw new EditorError('invalid variant', 400, 'variant');
        if (body.profile != null && typeof body.profile !== 'string') throw new EditorError('invalid profile', 400, 'profile');
        if (!listProfiles().includes(body.profile || 'generic')) throw new EditorError(`unknown profile '${body.profile}'`, 400, 'profile');
        const result = await withAssetOperation(body.slug, async () => {
          if (body.skin) throw new EditorError('skins are preview-only', 400, 'skin');
          await requireEditableAsset(body.slug);
          await replaceEditorScope(body);
          return editorPayload(body.slug, { variant: body.variant || null, profile: body.profile || 'generic' });
        });
        return send(res, 200, result);
      }
      if (p === '/api/history/save' && req.method === 'POST') {
        requireLocalJson(req);
        const body = await readBody(req);
        requestSlug = body.slug;
        requestLook = { variant: body.variant || null, profile: body.profile || 'generic' };
        if (Object.hasOwn(body, 'skin')) throw new EditorError('skins are preview-only', 400, 'skin');
        assertEditorSlug(body.slug);
        if (typeof body.note !== 'string' || !body.note.trim() || body.note.length > 500) throw new EditorError('note required (max 500 characters)', 400, 'note');
        const result = await withAssetOperation(body.slug, async () => {
          if (body.expectedRevision !== editorRevision(body.slug)) throw new EditorError('source changed', 409);
          const def = await requireEditableAsset(body.slug);
          if (body.variant && !Object.hasOwn(def.variants, body.variant)) throw new EditorError(`unknown variant '${body.variant}'`, 404);
          const args = ['save', body.slug, '-m', body.note.trim(), '--include-variants'];
          if (body.variant) args.push('--preferred-variant', body.variant);
          const saved = await runJsonCli(args);
          if (editorRevision(body.slug) !== body.expectedRevision) throw new EditorError('source changed while saving', 409);
          return { result: saved, revision: editorRevision(body.slug) };
        });
        return send(res, 200, result);
      }
      if (p === '/api/history/restore' && req.method === 'POST') {
        requireLocalJson(req);
        const body = await readBody(req);
        requestSlug = body.slug;
        if (Object.hasOwn(body, 'skin')) throw new EditorError('skins are preview-only', 400, 'skin');
        assertEditorSlug(body.slug);
        if (typeof body.version !== 'string' || !/^v\d+$/.test(body.version)) throw new EditorError('invalid version', 400, 'version');
        const result = await withAssetOperation(body.slug, async () => {
          if (body.expectedRevision !== editorRevision(body.slug)) throw new EditorError('source changed', 409);
          await requireEditableAsset(body.slug);
          const { getVersion } = await import('../core/history.js');
          try { getVersion(body.slug, body.version); } catch { throw new EditorError(`version '${body.version}' not found`, 404); }
          const restored = await runJsonCli(['revert', body.slug, body.version], { timeoutMs: 120000 });
          schedule(body.slug);
          return { result: restored, revision: editorRevision(body.slug) };
        });
        return send(res, 200, result);
      }
      if (p === '/api/export' && req.method === 'POST') {
        requireLocalJson(req);
        const body = await readBody(req);
        requestSlug = body.slug;
        requestLook = { variant: body.variant || null, skin: body.skin || null, profile: body.profile || 'generic' };
        assertEditorSlug(body.slug);
        const result = await withAssetOperation(body.slug, async () => {
          if (body.expectedRevision !== editorRevision(body.slug)) throw new EditorError('source changed', 409);
          const profile = body.profile || 'generic';
          if (!listProfiles().includes(profile)) throw new EditorError(`unknown profile '${profile}'`, 400, 'profile');
          const def = await loadAssetDef(body.slug);
          if (body.variant && !Object.hasOwn(def.variants, body.variant)) throw new EditorError(`unknown variant '${body.variant}'`, 404);
          if (body.skin && !Object.hasOwn(def.skins, body.skin)) throw new EditorError(`unknown skin '${body.skin}'`, 404);
          const editor = await editorPayload(body.slug, requestLook);
          if (!editor.preview.current) throw new EditorError('preview is stale; build the selected look before export', 409);
          const args = ['export', body.slug, '--profile', profile, '--variant', body.variant || 'base', '--skin', body.skin || 'default'];
          const exported = await runJsonCli(args, { timeoutMs: 120000 });
          if (body.expectedRevision !== editorRevision(body.slug)) throw new EditorError('source changed while exporting', 409);
          return { result: exported.results?.[0] || { blocked: true, reason: exported.error || 'export failed' }, revision: editorRevision(body.slug) };
        });
        return send(res, 200, result);
      }
      if (p === '/api/build' && req.method === 'POST') {
        const body = await readBody(req);
        assertEditorSlug(body.slug);
        if (body.profile != null && typeof body.profile !== 'string') throw new EditorError('invalid profile', 400, 'profile');
        if (body.variant != null && typeof body.variant !== 'string') throw new EditorError('invalid variant', 400, 'variant');
        if (body.skin != null && typeof body.skin !== 'string') throw new EditorError('invalid skin', 400, 'skin');
        const profile = body.profile || 'generic';
        if (typeof profile !== 'string' || !listProfiles().includes(profile)) throw new EditorError(`unknown profile '${profile}'`, 400, 'profile');
        const def = await loadAssetDef(body.slug);
        const variant = body.variant === 'base' ? null : body.variant || null;
        const skin = body.skin === 'default' ? null : body.skin || null;
        if (variant && (typeof variant !== 'string' || !Object.hasOwn(def.variants, variant))) throw new EditorError(`unknown variant '${variant}'`, 404, 'variant');
        if (skin && (typeof skin !== 'string' || !Object.hasOwn(def.skins, skin))) throw new EditorError(`unknown skin '${skin}'`, 404, 'skin');
        activeProfiles.add(profile);
        noteLook(body.slug, variant, skin);
        const result = await enqueue(body.slug, variant, profile, skin);
        return send(res, 200, result);
      }
      if (p === '/api/scenes' && req.method === 'GET') {
        const scenes = listSceneNames().map((name) => {
          try {
            const { scene, revision } = readScene(name);
            return { name, title: scene.title, room: scene.room ? [scene.room.width, scene.room.depth, scene.room.height] : null, instances: scene.instances.length, revision };
          } catch (err) {
            return { name, title: name, error: err.message };
          }
        });
        return send(res, 200, { scenes });
      }
      if (p === '/api/library' && req.method === 'GET') {
        return send(res, 200, { assets: await libraryEntries({ looks: true }) });
      }
      if (p === '/api/scene' && req.method === 'GET') {
        const name = url.searchParams.get('name');
        requireScene(name);
        return send(res, 200, scenePayload(name, url.searchParams.get('profile') || 'generic'));
      }
      if (p === '/api/scene/shell' && req.method === 'GET') {
        // The shell is kit code only (no asset module runs), so it is built in-process and cached.
        const name = url.searchParams.get('name');
        const profile = url.searchParams.get('profile') || 'generic';
        requireScene(name);
        if (!listProfiles().includes(profile)) throw new EditorError(`unknown profile '${profile}'`, 400, 'profile');
        const { scene, revision } = readScene(name);
        if (!scene.room) return send(res, 200, { name, profile, revision, url: null });
        const shell = await withAssetOperation(`scene-shell:${name}`, () => buildShell({ name, room: scene.room, title: scene.title, profileId: profile }));
        return send(res, 200, { name, profile, revision, url: `/files/scenes/${name}/shell.${profile}.glb?h=${shell.info.sha256.slice(0, 12)}`, ok: shell.info.ok, issues: shell.info.issues });
      }
      if (p === '/api/scene/item' && req.method === 'GET') {
        const q = url.searchParams;
        return send(res, 200, await sceneItem(q.get('slug'), q.get('variant') || null, q.get('skin') || null, q.get('profile') || 'generic'));
      }
      if (p === '/api/scene/create' && req.method === 'POST') {
        requireLocalJson(req);
        const body = await readBody(req);
        const created = createScene(body.name, { title: typeof body.title === 'string' ? body.title : null, room: body.room === undefined ? undefined : body.room });
        return send(res, 200, scenePayload(created.name, body.profile || 'generic'));
      }
      if (p === '/api/scene' && req.method === 'PUT') {
        requireLocalJson(req);
        const body = await readBody(req, SCENE_BODY_LIMIT);
        requireScene(body.name);
        requestScene = { name: body.name, profile: body.profile || 'generic' };
        if (typeof body.expectedRevision !== 'string') throw new SceneError('expectedRevision required', 400, 'expectedRevision');
        const result = await withAssetOperation(`scene:${body.name}`, async () => {
          writeScene(body.name, body.scene, { expectedRevision: body.expectedRevision });
          return scenePayload(body.name, requestScene.profile);
        });
        return send(res, 200, result);
      }
      if ((p === '/api/scene/build' || p === '/api/scene/export') && req.method === 'POST') {
        requireLocalJson(req);
        const body = await readBody(req);
        requireScene(body.name);
        const profile = body.profile || 'generic';
        if (typeof profile !== 'string' || !listProfiles().includes(profile)) throw new EditorError(`unknown profile '${profile}'`, 400, 'profile');
        requestScene = { name: body.name, profile };
        const exporting = p === '/api/scene/export';
        const result = await withAssetOperation(`scene:${body.name}`, async () => {
          if (body.expectedRevision && body.expectedRevision !== sceneRevision(body.name)) throw new SceneError('scene changed on disk', 409);
          const cli = await runJsonCli(['scene', exporting ? 'export' : 'build', body.name, '--profile', profile], { timeoutMs: 300000 });
          const first = cli.results?.[0] || null;
          if (!first) throw new EditorError(cli.error || `scene ${exporting ? 'export' : 'build'} failed`, 500);
          return { result: first, ...scenePayload(body.name, profile) };
        });
        return send(res, 200, result);
      }
      if (p === '/api/scene/save' && req.method === 'POST') {
        requireLocalJson(req);
        const body = await readBody(req);
        requireScene(body.name);
        requestScene = { name: body.name, profile: body.profile || 'generic' };
        if (typeof body.note !== 'string' || !body.note.trim() || body.note.length > 500) throw new SceneError('note required (max 500 characters)', 400, 'note');
        const result = await withAssetOperation(`scene:${body.name}`, async () => {
          if (body.expectedRevision && body.expectedRevision !== sceneRevision(body.name)) throw new SceneError('scene changed on disk', 409);
          const saved = await runJsonCli(['scene', 'save', body.name, '-m', body.note.trim()]);
          return { result: saved, ...scenePayload(body.name, requestScene.profile) };
        });
        return send(res, 200, result);
      }
      if (p === '/api/scene/restore' && req.method === 'POST') {
        requireLocalJson(req);
        const body = await readBody(req);
        requireScene(body.name);
        requestScene = { name: body.name, profile: body.profile || 'generic' };
        if (typeof body.version !== 'string' || !/^v\d+$/.test(body.version)) throw new SceneError('invalid version', 400, 'version');
        const result = await withAssetOperation(`scene:${body.name}`, async () => {
          const restored = await runJsonCli(['scene', 'restore', body.name, body.version]);
          if (restored.error) throw new SceneError(restored.error, 404);
          return { result: restored, ...scenePayload(body.name, requestScene.profile) };
        });
        return send(res, 200, result);
      }
      if (p === '/api/thumb' && req.method === 'PUT') {
        requireLocal(req, /^image\/png$/i, 'image/png');
        const item = url.searchParams.get('item') || '';
        const hash = url.searchParams.get('hash') || '';
        const parsed = parseItemId(item);
        if (!parsed || itemId(parsed.slug, parsed.variant, parsed.skin) !== item) throw new EditorError('invalid item', 400, 'item');
        assertEditorSlug(parsed.slug);
        const report = readJson(previewReport(parsed.slug, parsed.variant, 'generic', parsed.skin), null);
        // Only the thumbnail of the current generic GLB is kept: a stale upload is dropped.
        if (!report || report.hashes?.glb !== hash) throw new EditorError('thumbnail does not match the current preview', 409);
        const png = await readBinary(req, THUMB_LIMIT);
        if (png.length < 64 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new EditorError('not a PNG image', 400);
        const files = thumbFiles(item);
        writeFileAtomic(files.png, png);
        writeJson(files.meta, { hash });
        return send(res, 200, { thumb: thumbUrl(item, hash) });
      }
      if (p === '/api/notify' && req.method === 'POST') {
        const body = await readBody(req);
        for (const item of body.items || []) broadcast('built', { ...item, external: true });
        if (body.type && body.type !== 'built') broadcast(body.type, body);
        return send(res, 200, { ok: true });
      }
      if (serveMounted(p, res)) return;
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      const status = err.status || 500;
      const body = { error: err.message, code: err.code || (status === 500 ? 'internal_error' : 'operation_failed') };
      if (err.field) body.field = err.field;
      if (status === 409) {
        if (requestSlug) try { body.current = await editorPayload(requestSlug, requestLook); } catch {}
        if (requestScene) try { body.current = scenePayload(requestScene.name, requestScene.profile); } catch {}
      }
      return send(res, status, body);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, host, resolve);
  });
  const actualPort = server.address().port;
  const info = { port: actualPort, pid: process.pid, url: `http://${host}:${actualPort}/` };
  // CLI builds notify the server named in this file. A second server (a test, a capture run)
  // must not take that over from one that is still running.
  const other = readJson(paths.serverInfo, null);
  let otherAlive = false;
  if (other && other.pid && other.pid !== process.pid) {
    try {
      process.kill(other.pid, 0);
      otherAlive = true;
    } catch {
      // stale file from a server that is gone
    }
  }
  if (!otherAlive) writeJson(paths.serverInfo, info);
  const close = () => {
    for (const w of watchers) w.close();
    for (const c of clients) c.end();
    server.close();
    try {
      if (readJson(paths.serverInfo, {}).pid === process.pid) fs.rmSync(paths.serverInfo, { force: true });
    } catch {
      // ignore
    }
  };
  return { server, info, close, enqueue };
}
