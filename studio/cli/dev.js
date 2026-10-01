// node studio dev [--port 5178] [--open]

import { spawn } from 'node:child_process';
import { parse } from './args.js';
import { startServer } from '../server/server.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio dev [--port <n>] [--open]

Starts the live viewport at http://127.0.0.1:<port>/ (default 5178).
Edits to assets/** and sets/** rebuild automatically; the viewport reloads the new GLB.
Builds started from the CLI (node studio build/review/...) also refresh the viewport.`;

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // no browser available
  }
}

export async function run(argv) {
  const { opts } = parse(argv, { port: { type: 'string' }, open: { type: 'boolean', default: false } }, USAGE);
  const { info, close } = await startServer({ port: opts.port ? Number(opts.port) : undefined });
  console.log(`${sym.ok} ${c.bold('AI 3D Asset Studio')} viewport: ${c.cyan(info.url)}`);
  console.log(c.gray('  watching assets/ and sets/ — edits rebuild automatically. Ctrl+C to stop.'));
  if (opts.open) openBrowser(info.url);
  await new Promise((resolve) => {
    const stop = () => {
      close();
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}
