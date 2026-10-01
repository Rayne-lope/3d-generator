// node studio save <slug|set:name> -m "<prompt>" [--pin] [--force]

import { parse } from './args.js';
import { saveVersion, parseTarget, listVersions } from '../core/history.js';
import { loadConfig } from '../core/config.js';
import { c, sym, fmtNum } from '../core/log.js';
import { buildGeneric, renderVersionThumbnail, signed } from './history-util.js';
import { paths } from '../core/paths.js';
import { readJson, writeJson } from '../core/fsutil.js';

function recordSave(t) {
  try {
    const m = readJson(paths.metrics, { assets: {} });
    const now = new Date().toISOString();
    for (const slug of t.members) {
      const a = m.assets[slug] || {};
      if (!a.firstSavedAt) a.firstSavedAt = now;
      a.saves = (a.saves || 0) + 1;
      m.assets[slug] = a;
    }
    writeJson(paths.metrics, m);
  } catch {
    // metrics are best effort
  }
}

const USAGE = `Usage: node studio save <slug | set:<name>> -m "<what the user asked>" [options]

Saves a version: a snapshot of the asset source (or the set folder + all members), the generic
GLB and a thumbnail, in .studio/history/. Run it after every generate or revise step with the
user's own words as the message. Nothing is saved when the source did not change.

Options:
  -m, --message <text>  the prompt / revision request this version answers (required)
  --pin                 pin the version (never pruned)
  --force               save even if nothing changed
  --no-thumb            skip the thumbnail render (no browser needed)
  --json`;

export async function run(argv) {
  const { args, opts } = parse(argv, {
    message: { type: 'string', short: 'm' },
    pin: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    'no-thumb': { type: 'boolean', default: false },
  }, USAGE);
  if (args.length !== 1) throw new Error(USAGE);
  if (!opts.message || !opts.message.trim()) throw new Error(`save needs -m "<the user's request>" so the history stays readable.\n\n${USAGE}`);
  const t = parseTarget(args[0]);
  const before = listVersions(t);
  const res = await saveVersion(t, {
    note: opts.message.trim(),
    pin: opts.pin,
    force: opts.force,
    build: buildGeneric,
    thumbnail: opts['no-thumb'] ? null : renderVersionThumbnail,
  });
  if (!res.skipped) recordSave(t);
  if (opts.json) {
    console.log(JSON.stringify(res, null, 2));
    return 0;
  }
  if (res.skipped) {
    console.log(`${sym.info} ${res.reason} — nothing saved ${c.gray('(use --force to save anyway)')}`);
    return 0;
  }
  const v = res.version;
  const prev = before.find((x) => x.id === v.parent);
  const delta = prev ? c.gray(` (${signed(v.triangles - prev.triangles)} vs ${prev.id})`) : '';
  console.log(`${sym.ok} saved ${c.bold(t.label)} ${c.cyan(v.id)}${v.pinned ? ' 📌' : ''} — "${v.note}"`);
  console.log(`  ${fmtNum(v.triangles)} tris${delta} · ${res.dir}`);
  const errors = Object.values(v.stats).reduce((s, x) => s + x.errors, 0);
  if (errors) console.log(`  ${sym.warn} saved with ${errors} validation error(s); they block export.`);
  if (res.pruned?.length) console.log(c.gray(`  pruned ${res.pruned.join(', ')} (keeping ${loadConfig().history.keep} + pinned)`));
  return 0;
}
