// node studio compare <a> <b> [--profile p] [--views iso,front] [--out file.png]

import path from 'node:path';
import fs from 'node:fs';
import { parse } from './args.js';
import { withCapture } from '../core/render/capture.js';
import { buildItem } from '../core/build.js';
import { paths, rel, itemId } from '../core/paths.js';
import { loadConfig } from '../core/config.js';
import { writeDataUrl } from '../core/render/image.js';
import { ensureDir } from '../core/fsutil.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio compare <assetA[--variant]> <assetB[--variant]> [options]

Renders two assets from the same cameras and lighting into one side-by-side sheet. Use it for
A/B checks (e.g. the same prompt made with and without rules/) or to compare variants.

Options:
  --profile <id>   profile to build (default generic)
  --views <list>   default: front,right,iso
  --size <px>      tile size (default 420)
  --out <file>     also copy the sheet to this path (e.g. docs/demos/img/ab.png)`;

function splitId(id) {
  const [slug, variant] = id.split('--');
  return { slug, variant: variant || null };
}

export async function run(argv) {
  const { args, opts } = parse(argv, { profile: { type: 'string', default: 'generic' }, views: { type: 'string', default: 'front,right,iso' }, size: { type: 'string', default: '420' }, out: { type: 'string' } }, USAGE);
  if (args.length !== 2) throw new Error(USAGE);
  const views = opts.views.split(',');
  const size = Number(opts.size);
  const items = args.map(splitId);
  const reports = [];
  for (const it of items) reports.push((await buildItem({ ...it, profileId: opts.profile })).report);
  const file = path.join(paths.shots, '_compare', `${itemId(items[0].slug, items[0].variant)}__${itemId(items[1].slug, items[1].variant)}.png`);
  await withCapture(async (api) => {
    const tiles = [];
    const renders = [];
    for (const it of items) {
      renders.push(await api.renderGLB({ url: `${api.url}files/preview/${itemId(it.slug, it.variant)}/${opts.profile}.glb`, views, size }));
    }
    for (let r = 0; r < 2; r++) {
      for (const v of views) tiles.push({ image: renders[r].images[v], label: `${args[r]} · ${v}` });
    }
    const lines = reports.map((rep, i) => `${'AB'[i]}: ${args[i]} — ${rep.triangles.total.toLocaleString('en-US')} tris, ${rep.materials.length} materials, ${rep.counts.error} err / ${rep.counts.warning} warn`);
    const sheet = await api.sheet({ tiles, columns: views.length, tileSize: size, title: `Compare: ${args[0]}  vs  ${args[1]}`, lines: [reports[0].prompt ? `Prompt: ${reports[0].prompt}` : '', ...lines].filter(Boolean) });
    writeDataUrl(file, sheet);
  });
  if (opts.out) {
    ensureDir(path.dirname(path.resolve(opts.out)));
    fs.copyFileSync(file, path.resolve(opts.out));
  }
  if (opts.json) console.log(JSON.stringify({ sheet: rel(file), out: opts.out || null }));
  else console.log(`${sym.ok} compare sheet: ${c.cyan(rel(file))}${opts.out ? ` (copied to ${opts.out})` : ''}`);
  return 0;
}
