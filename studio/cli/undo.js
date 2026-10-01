// node studio undo <slug|set:name>

import { parse } from './args.js';
import { parseTarget, undo } from '../core/history.js';
import { buildGeneric, rebuildAfterRestore, renderVersionThumbnail } from './history-util.js';
import { printRestore } from './revert.js';

const USAGE = `Usage: node studio undo <slug | set:<name>> [options]

Goes back one step:
  - with unsaved changes: back to the last saved/restored version (changes are auto-saved first)
  - otherwise: back to the version this one was made from (its parent)
Run it again to keep stepping back. Every step is reversible with 'node studio revert'.

Options:
  --no-build   restore files only
  --no-thumb   skip the thumbnail render of the auto-save
  --json`;

export async function run(argv) {
  const { args, opts } = parse(argv, { 'no-build': { type: 'boolean', default: false }, 'no-thumb': { type: 'boolean', default: false } }, USAGE);
  if (args.length !== 1) throw new Error(USAGE);
  const t = parseTarget(args[0]);
  const res = await undo(t, { build: buildGeneric, thumbnail: opts['no-thumb'] ? null : renderVersionThumbnail });
  if (!opts['no-build']) await rebuildAfterRestore(t);
  return printRestore(t, res, opts, 'undo: back to');
}
