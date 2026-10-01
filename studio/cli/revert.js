// node studio revert <slug|set:name> <vNNN>

import { parse } from './args.js';
import { parseTarget, revertVersion } from '../core/history.js';
import { c, sym } from '../core/log.js';
import { buildGeneric, rebuildAfterRestore, renderVersionThumbnail } from './history-util.js';

const USAGE = `Usage: node studio revert <slug | set:<name>> <vNNN> [options]

Restores a saved version into the working copy (assets/<slug>/, or the set folder + members).
Unsaved changes are auto-saved as a new version first, so a revert never loses work.
The previews are rebuilt so the viewport shows the restored asset.

Options:
  --no-build   restore files only
  --no-thumb   skip the thumbnail render of the auto-save
  --json`;

export async function run(argv) {
  const { args, opts } = parse(argv, { 'no-build': { type: 'boolean', default: false }, 'no-thumb': { type: 'boolean', default: false } }, USAGE);
  if (args.length !== 2) throw new Error(USAGE);
  const t = parseTarget(args[0]);
  const res = await revertVersion(t, args[1], { build: buildGeneric, thumbnail: opts['no-thumb'] ? null : renderVersionThumbnail });
  if (!opts['no-build']) await rebuildAfterRestore(t);
  return printRestore(t, res, opts);
}

export function printRestore(t, res, opts, verb = 'restored') {
  if (opts.json) {
    console.log(JSON.stringify({ target: t.label, restored: res.restored, autosaved: res.autosaved }, null, 2));
    return 0;
  }
  const where = t.kind === 'set' ? `sets/${t.name}/ + ${t.members.length} member assets` : `assets/${t.name}/`;
  console.log(`${sym.ok} ${verb} ${c.bold(t.label)} ${c.cyan(res.restored)}${res.version?.note ? ` — "${res.version.note}"` : ''} into ${where}`);
  if (res.autosaved) console.log(`  unsaved changes were auto-saved as ${c.cyan(res.autosaved)} (node studio revert ${t.label} ${res.autosaved} brings them back)`);
  return 0;
}
