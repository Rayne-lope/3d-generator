// Local studio server: serves the viewport, preview GLBs and a small JSON API, watches
// asset sources and rebuilds them in child processes, and pushes reload events (SSE).
// Binds to 127.0.0.1 only.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths, previewReport, itemId, ROOT } from '../core/paths.js';
import { readJson, writeJson, ensureDir } from '../core/fsutil.js';
import { listAssets, listSets, loadSet } from '../core/targets.js';
import { listProfiles, loadProfile } from '../profiles/index.js';
import { loadConfig } from '../core/config.js';

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
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
    const report = readJson(previewReport(slug, null, 'generic'), null);
    if (report) {
      meta = { title: report.title, category: report.category, style: report.style, set: report.set, prompt: report.prompt };
    }
    try {
      const fresh = await import(`../../assets/${slug}/asset.js?t=${fs.statSync(path.join(paths.assets, slug, 'asset.js')).mtimeMs}`);
      const def = fresh.default;
      meta = { title: def.meta.title, category: def.meta.category, style: def.meta.style, set: def.meta.set || null, prompt: def.meta.prompt || '' };
      variants = Object.keys(def.variants || {});
    } catch {
      try {
        const def = await loadAssetDef(slug);
        variants = Object.keys(def.variants || {});
      } catch {
        // broken module: still list it so the viewport can show the error
      }
    }
    const profiles = {};
    for (const p of listProfiles()) {
      const r = readJson(previewReport(slug, null, p), null);
      if (r) profiles[p] = { ok: r.ok, counts: r.counts, triangles: r.triangles.total, builtAt: r.builtAt };
    }
    out.push({ slug, ...(meta || { title: slug }), variants, profiles });
  }
  return out;
}

export async function startServer({ port, host = '127.0.0.1' } = {}) {
  const config = loadConfig();
  const listenPort = port ?? config.server.port;
  const clients = new Set();
  const activeProfiles = new Set(['generic']);
  const queue = [];
  let running = null;
  const lastErrors = new Map();

  const broadcast = (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  };

  const runBuild = (job) => new Promise((resolve) => {
    const args = [path.join(ROOT, 'studio', 'index.js'), 'build', job.slug, '--profile', job.profile, '--json'];
    if (job.variant) args.push('--variant', job.variant);
    else args.push('--variant', 'base');
    broadcast('build-start', { slug: job.slug, variant: job.variant || null, profile: job.profile });
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, STUDIO_NO_NOTIFY: '1' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', () => {
      let result = { slug: job.slug, variant: job.variant || null, profile: job.profile, ok: false };
      try {
        const parsed = JSON.parse(stdout.slice(stdout.indexOf('{')));
        const r = parsed.results?.[0];
        if (r) result = { ...result, ok: r.ok, counts: r.counts, error: r.error || null, cached: r.cached };
      } catch {
        result.error = (stderr || stdout).trim().split('\n').slice(-6).join('\n') || 'build failed';
      }
      const key = `${itemId(job.slug, job.variant)}|${job.profile}`;
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
    for (const w of job.waiters) w(result);
    running = null;
    pump();
  };

  const enqueue = (slug, variant, profile) => new Promise((resolve) => {
    const existing = queue.find((j) => j.slug === slug && j.variant === variant && j.profile === profile);
    if (existing) existing.waiters.push(resolve);
    else queue.push({ slug, variant, profile, waiters: [resolve] });
    pump();
  });

  // Watch sources: assets/<slug>/** and sets/<set>/** (a set change rebuilds its members).
  const timers = new Map();
  const schedule = (slug) => {
    clearTimeout(timers.get(slug));
    timers.set(slug, setTimeout(() => {
      timers.delete(slug);
      for (const profile of activeProfiles) enqueue(slug, null, profile);
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

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = decodeURIComponent(url.pathname);
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
          building: running ? { slug: running.slug, variant: running.variant || null, profile: running.profile } : null,
        });
      }
      if (p === '/api/report') {
        const slug = url.searchParams.get('slug');
        const variant = url.searchParams.get('variant') || null;
        const profile = url.searchParams.get('profile') || 'generic';
        if (listProfiles().includes(profile)) activeProfiles.add(profile);
        const report = readJson(previewReport(slug, variant, profile), null);
        const error = lastErrors.get(`${itemId(slug, variant)}|${profile}`) || null;
        return send(res, report || error ? 200 : 404, { report, error });
      }
      if (p === '/api/history') {
        const slug = url.searchParams.get('slug');
        const { versionsForAsset } = await import('../core/history.js');
        return send(res, 200, { versions: versionsForAsset(slug) });
      }
      if (p === '/api/build' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.slug) return send(res, 400, { error: 'slug required' });
        const profile = body.profile || 'generic';
        loadProfile(profile);
        activeProfiles.add(profile);
        const result = await enqueue(body.slug, body.variant || null, profile);
        return send(res, 200, result);
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
      return send(res, 500, { error: err.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, host, resolve);
  });
  const actualPort = server.address().port;
  const info = { port: actualPort, pid: process.pid, url: `http://${host}:${actualPort}/` };
  writeJson(paths.serverInfo, info);
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
