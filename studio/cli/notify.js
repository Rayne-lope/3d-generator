// Tell a running dev server (if any) that previews changed, so the viewport reloads.

import fs from 'node:fs';
import http from 'node:http';
import { paths } from '../core/paths.js';

export function notifyServer(payload) {
  return new Promise((resolve) => {
    if (process.env.STUDIO_NO_NOTIFY) {
      resolve(false);
      return;
    }
    let info;
    try {
      info = JSON.parse(fs.readFileSync(paths.serverInfo, 'utf8'));
    } catch {
      resolve(false);
      return;
    }
    const body = JSON.stringify(payload);
    const req = http.request({ host: '127.0.0.1', port: info.port, path: '/api/notify', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end(body);
  });
}
