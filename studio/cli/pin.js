// node studio pin|unpin <slug|set:name> <vNNN>

import { parse } from './args.js';
import { parseTarget, setPinned } from '../core/history.js';
import { c, sym } from '../core/log.js';

const usage = (cmd) => `Usage: node studio ${cmd} <slug | set:<name>> <vNNN> [--json]

${cmd === 'pin' ? 'Pins a version so it is never pruned (history keeps the last N versions plus every pinned one).' : 'Removes the pin; the version is pruned normally once it falls out of the last N.'}`;

export async function run(argv, cmd = 'pin') {
  const { args, opts } = parse(argv, {}, usage(cmd));
  if (args.length !== 2) throw new Error(usage(cmd));
  const t = parseTarget(args[0]);
  const v = setPinned(t, args[1], cmd === 'pin');
  if (opts.json) console.log(JSON.stringify({ target: t.label, id: v.id, pinned: v.pinned }));
  else console.log(`${sym.ok} ${c.bold(t.label)} ${c.cyan(v.id)} ${v.pinned ? 'pinned 📌' : 'unpinned'}${v.note ? ` — "${v.note}"` : ''}`);
  return 0;
}
