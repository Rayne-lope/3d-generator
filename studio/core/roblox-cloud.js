// Roblox Open Cloud client (Assets API) used by `node studio publish --roblox`.
//
//   POST  /assets/v1/assets               create a Model (.glb) or Image (.png) asset
//   PATCH /assets/v1/assets/{assetId}     upload a new version of a Model
//   GET   /assets/v1/operations/{id}      results arrive as long-running operations
//
// The API key travels only in the x-api-key header. It is never logged, never written to a
// report and never part of an error message. Base URL, fetch and sleep are injectable so the
// tests can run against a local fake server.

import fs from 'node:fs';
import path from 'node:path';

export const OPEN_CLOUD_URL = 'https://apis.roblox.com';
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // per call (Open Cloud limit)

/** 'user:123', 'group:456' or a bare id (user) → { userId } | { groupId } */
export function parseCreator(value) {
  const v = String(value ?? '').trim();
  const m = /^(?:(user|group):)?(\d+)$/i.exec(v);
  if (!m) throw new Error(`creator must look like user:123 or group:456 (got '${v || 'nothing'}')`);
  return (m[1] || 'user').toLowerCase() === 'group' ? { groupId: m[2] } : { userId: m[2] };
}

export const creatorLabel = (c) => (c.groupId ? `group:${c.groupId}` : `user:${c.userId}`);

/** Minimal .env reader: KEY=value lines, # comments, optional quotes. */
export function readDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, '');
    out[m[1]] = val;
  }
  return out;
}

/**
 * Credentials from the environment, then a gitignored .env in the project root.
 * Flags (--user / --group) override ROBLOX_CREATOR.
 * @returns {{apiKey: string|null, creator: object|null, sources: {apiKey: string|null, creator: string|null}}}
 */
export function loadCredentials({ env = process.env, root, user = null, group = null } = {}) {
  const dot = root ? readDotEnv(path.join(root, '.env')) : {};
  const pick = (name) => (env[name] ? { value: env[name], source: 'environment' } : dot[name] ? { value: dot[name], source: '.env' } : { value: null, source: null });
  const key = pick('ROBLOX_API_KEY');
  let creator = null;
  let creatorSource = null;
  if (user) {
    creator = parseCreator(`user:${user}`);
    creatorSource = '--user';
  } else if (group) {
    creator = parseCreator(`group:${group}`);
    creatorSource = '--group';
  } else {
    const c = pick('ROBLOX_CREATOR');
    if (c.value) {
      creator = parseCreator(c.value);
      creatorSource = c.source;
    }
  }
  return { apiKey: key.value, creator, sources: { apiKey: key.source, creator: creatorSource } };
}

export class OpenCloudError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'OpenCloudError';
    this.status = status;
    this.code = code;
  }
}

const HINTS = {
  401: 'the API key is missing, wrong or expired (Creator Dashboard → Open Cloud → API Keys)',
  403: "the API key lacks the Assets API 'asset:read' + 'asset:write' permissions for this creator, or its IP restriction blocks this machine",
  404: 'the asset or operation does not exist for this creator',
  413: 'the file is larger than the Open Cloud limit (20 MB per upload)',
  429: 'rate limited (60 requests per minute per key); try again in a minute',
};

async function errorFrom(res) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = j.message || j.error?.message || j.errors?.[0]?.message || text;
    } catch {
      detail = text;
    }
  } catch {
    // no body
  }
  detail = String(detail).slice(0, 300);
  const hint = HINTS[res.status] ? ` — ${HINTS[res.status]}` : '';
  return new OpenCloudError(`Open Cloud ${res.status}${detail ? `: ${detail}` : ''}${hint}`, { status: res.status });
}

/**
 * @param {{apiKey: string, baseUrl?: string, fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>,
 *          minInterval?: number, pollTimeoutMs?: number, retries?: number}} opts
 */
export function createClient({ apiKey, baseUrl = OPEN_CLOUD_URL, fetch: fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), minInterval = 1100, pollTimeoutMs = 180000, retries = 4 } = {}) {
  if (!apiKey) throw new OpenCloudError('no Roblox API key (set ROBLOX_API_KEY in the environment or in .env)');
  const base = baseUrl.replace(/\/+$/, '');
  let last = 0;
  let requests = 0;

  // Spread requests out (Open Cloud allows 60 per minute per key) and retry 429/5xx.
  async function call(method, url, body) {
    for (let attempt = 0; ; attempt++) {
      const wait = last + minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      requests++;
      const res = await fetchImpl(url, { method, headers: { 'x-api-key': apiKey }, body: typeof body === 'function' ? body() : body });
      if (res.ok) return res.status === 204 ? {} : res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const after = Number(res.headers?.get?.('retry-after'));
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * 2 ** attempt);
        continue;
      }
      throw await errorFrom(res);
    }
  }

  const form = (request, file) => () => {
    const fd = new FormData();
    fd.append('request', JSON.stringify(request));
    fd.append('fileContent', new Blob([file.bytes], { type: file.contentType }), file.name);
    return fd;
  };

  function checkSize(file) {
    if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new OpenCloudError(`${file.name} is ${(file.bytes.byteLength / 1048576).toFixed(1)} MB; Open Cloud accepts up to 20 MB per upload (lower the triangle count or texture sizes)`, { status: 413 });
    }
  }

  /** Poll an operation until it is done; returns the asset (operation.response). */
  async function waitOperation(op) {
    const started = Date.now();
    let delay = 1000;
    let cur = op;
    while (!cur.done) {
      if (Date.now() - started > pollTimeoutMs) throw new OpenCloudError(`operation ${cur.operationId || cur.path} still running after ${Math.round(pollTimeoutMs / 1000)} s`);
      await sleep(delay);
      delay = Math.min(delay * 1.5, 5000);
      const id = cur.operationId || String(cur.path || '').split('/').pop();
      cur = await call('GET', `${base}/assets/v1/operations/${encodeURIComponent(id)}`);
    }
    if (cur.error) throw new OpenCloudError(`upload failed: ${cur.error.message || JSON.stringify(cur.error)}`, { code: cur.error.code });
    const asset = cur.response || {};
    if (!asset.assetId && asset.path) asset.assetId = String(asset.path).split('/').pop();
    return asset;
  }

  return {
    get requests() {
      return requests;
    },
    waitOperation,
    /**
     * @param {{assetType: 'Model'|'Image'|'Decal', displayName: string, description?: string, creator: object,
     *          file: {bytes: Uint8Array, name: string, contentType: string}}} a
     */
    async createAsset({ assetType, displayName, description = '', creator, file }) {
      checkSize(file);
      const request = { assetType, displayName: displayName.slice(0, 50), description: description.slice(0, 1000), creationContext: { creator } };
      const op = await call('POST', `${base}/assets/v1/assets`, form(request, file));
      return waitOperation(op);
    },
    /** New version of an existing Model (Open Cloud updates content of Models only). */
    async updateAsset({ assetId, file }) {
      checkSize(file);
      const op = await call('PATCH', `${base}/assets/v1/assets/${encodeURIComponent(assetId)}`, form({ assetId: String(assetId) }, file));
      return waitOperation(op);
    },
  };
}
