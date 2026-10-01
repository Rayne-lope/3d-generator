// node studio engine-pack <godot|roblox|all> [--variants|--no-variants]

import { parse } from './args.js';
import { packGodot, packRoblox } from '../core/engines.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio engine-pack <godot | roblox | all> [options]

Prepares the golden set for checks inside the real engines:
  godot   engines/godot/golden/*.glb + manifest.json (Godot profile). Then run
          'node studio engine-verify godot' or open engines/godot in Godot (F5 = gallery).
  roblox  engines/roblox/golden/*.glb (Roblox profile, studs) + GoldenManifest.lua +
          GoldenVerify.rbxlx. Then follow engines/roblox/CHECKLIST.md in Roblox Studio.

Options:
  --variants      include every variant (default for godot)
  --no-variants   base assets only (default for roblox, where each GLB is imported by hand)
  --json`;

export async function run(argv) {
  const { args, opts } = parse(argv, { variants: { type: 'boolean' }, 'no-variants': { type: 'boolean', default: false } }, USAGE);
  const target = args[0];
  if (!['godot', 'roblox', 'all'].includes(target)) throw new Error(USAGE);
  const pick = (dflt) => (opts['no-variants'] ? false : opts.variants ?? dflt);
  const results = {};
  if (target === 'godot' || target === 'all') results.godot = await packGodot({ variants: pick(true) });
  if (target === 'roblox' || target === 'all') results.roblox = await packRoblox({ variants: pick(false) });
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return 0;
  }
  if (results.godot) {
    const r = results.godot;
    console.log(`${sym.ok} godot: ${r.count} GLBs + manifest.json in ${c.cyan(r.dir)}`);
    console.log(c.gray('   next: node studio engine-verify godot   (or open engines/godot in Godot 4.3+ and press F5)'));
  }
  if (results.roblox) {
    const r = results.roblox;
    console.log(`${sym.ok} roblox: ${r.count} GLBs in ${c.cyan(r.dir)}, ${c.cyan(r.manifest)}, template place ${c.cyan(r.place)}`);
    console.log(c.gray('   next: open the place in Roblox Studio and follow engines/roblox/CHECKLIST.md'));
  }
  for (const [engine, r] of Object.entries(results)) for (const s of r.skipped) console.log(`${sym.warn} ${engine}: skipped ${s.id} (${s.reason})`);
  return 0;
}
