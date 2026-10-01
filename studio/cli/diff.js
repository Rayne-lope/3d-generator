// node studio diff <slug|set:name> [vA] [vB] [--views ...] [--out file.png]

import fs from 'node:fs';
import path from 'node:path';
import { parse } from './args.js';
import { withCapture } from '../core/render/capture.js';
import { diffTarget, statsDelta } from '../core/diff.js';
import { ensureDir } from '../core/fsutil.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio diff <slug | set:<name>> [vA] [vB] [options]

Shows what changed between two states of an asset: renders both GLBs from the same cameras,
marks what changed (red = shape or strong color change, orange = subtle color/shading shift),
compares stats and diffs the source.

  diff <slug>             unsaved changes vs the last saved version; when there are none,
                          the current version vs the one it was made from
  diff <slug> v003        v003 vs the working copy
  diff <slug> v002 v004   two saved versions ('working' names the working copy)

After a revision, the red must stay inside the area the user asked to change.

Options:
  --views <list>   default: front,right,iso (sets: iso)
  --size <px>      tile size (default 360)
  --out <file>     also copy the sheet to this path (e.g. docs/demos/img/diff.png)
  --no-source      do not print the source diff
  --json`;

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function region(box) {
  if (!box) return '';
  const r = (a, b) => `${Math.round(a * 100)}–${Math.round(b * 100)}%`;
  return c.gray(` (x ${r(box.x0, box.x1)}, y ${r(box.y0, box.y1)})`);
}

function colorDiff(text, maxLines = 80) {
  const lines = text.split('\n');
  const shown = lines.slice(0, maxLines).map((l) => {
    if (l.startsWith('+++') || l.startsWith('---')) return c.bold(l);
    if (l.startsWith('@@')) return c.cyan(l);
    if (l.startsWith('+')) return c.green(l);
    if (l.startsWith('-')) return c.red(l);
    return c.gray(l);
  });
  if (lines.length > maxLines) shown.push(c.gray(`… ${lines.length - maxLines} more lines`));
  return shown.join('\n');
}

export async function run(argv) {
  const { args, opts } = parse(argv, {
    views: { type: 'string' },
    size: { type: 'string', default: '360' },
    out: { type: 'string' },
    'no-source': { type: 'boolean', default: false },
  }, USAGE);
  if (args.length < 1 || args.length > 3) throw new Error(USAGE);
  const [target, ...specs] = args;
  const res = await withCapture((api) => diffTarget(api, target, { specs, views: opts.views ? opts.views.split(',') : undefined, size: Number(opts.size) }));
  if (opts.out && res.sheet) {
    ensureDir(path.dirname(path.resolve(opts.out)));
    fs.copyFileSync(path.resolve(res.sheet), path.resolve(opts.out));
  }
  if (opts.json) {
    const { sourceText, ...rest } = res;
    console.log(JSON.stringify({ ...rest, out: opts.out || null }, null, 2));
    return 0;
  }
  console.log(`${c.bold(`Diff ${res.target}`)}: A ${c.cyan(res.a)} → B ${c.cyan(res.b)}`);
  for (const m of res.members) {
    const name = res.members.length > 1 ? `${c.bold(m.slug)}: ` : '  ';
    if (m.missing) {
      console.log(`${name}${c.gray(`not present in ${m.missing}`)}`);
      continue;
    }
    if (m.identical) {
      console.log(`${name}${sym.ok} no visible change`);
      continue;
    }
    console.log(`${name}${statsDelta(m.a, m.b)}`);
    console.log(`  changed pixels: ${Object.entries(m.views).map(([v, x]) => `${v} ${pct(x.ratio)}${region(x.box)}`).join(', ')}`);
    const subtle = Object.entries(m.views).filter(([, x]) => x.subtleRatio - x.ratio > 0.0005);
    if (subtle.length) console.log(`  subtle color/shading changes: ${subtle.map(([v, x]) => `${v} +${pct(x.subtleRatio - x.ratio)}${region(x.subtleBox)}`).join(', ')}`);
  }
  if (res.source.files.length) {
    console.log(`  source: ${c.green(`+${res.source.added}`)} ${c.red(`-${res.source.removed}`)} lines in ${res.source.files.join(', ')}`);
    if (!opts['no-source']) console.log(`\n${colorDiff(res.sourceText)}\n`);
  } else console.log(`  source: identical`);
  if (res.sheet) console.log(`${c.bold('diff sheet:')} ${c.cyan(res.sheet)}${opts.out ? ` (copied to ${opts.out})` : ''}  ${c.gray('rows = views · columns = A | B | changes (red = shape/strong, orange = subtle color/shading)')}`);
  console.log(c.gray(`patch: ${res.source.patch}`));
  return 0;
}
