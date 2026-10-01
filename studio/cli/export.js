// node studio export <slug|set:name|--all> --profile <generic|godot|roblox|all>

import { parse } from './args.js';
import { resolveTargets } from '../core/targets.js';
import { resolveProfiles } from '../profiles/index.js';
import { exportItem } from '../core/export.js';
import { describeError } from '../core/build.js';
import { withCapture } from '../core/render/capture.js';
import { c, sym, fmtBytes, fmtNum } from '../core/log.js';

const USAGE = `Usage: node studio export <slug | set:<name> | --all> --profile <id> [options]

Strict export to exports/<profile>/<slug>[--variant].glb with a .report.json and .report.md.
An item is exported only when:
  - the preflight finds 0 errors (fix them in the asset; never weaken a check),
  - a fresh rebuild reproduces the preview GLB byte for byte (Preview = Export),
and the source↔GLB parity render is recorded in the report (warning on mismatch).

Options:
  --profile <id>     generic | godot | roblox | all | comma list (required)
  --variant <name>   only this variant ('base' = no variant). Default: base + all variants
  --all              every asset in assets/
  --no-parity        skip the parity render (no browser needed)
  --allow-decimate   let the Roblox triangle limit decimate oversized pieces
  --json`;

export async function run(argv) {
  const { args, opts } = parse(argv, {
    profile: { type: 'string' },
    variant: { type: 'string' },
    all: { type: 'boolean', default: false },
    'no-parity': { type: 'boolean', default: false },
    'allow-decimate': { type: 'boolean', default: false },
  }, USAGE);
  if (!opts.profile) throw new Error(`export needs --profile (generic, godot, roblox or all)\n\n${USAGE}`);
  const profiles = resolveProfiles(opts.profile);
  const items = await resolveTargets(args, { all: opts.all, variant: opts.variant });
  const results = [];
  const runAll = async (api) => {
    for (const profileId of profiles) {
      for (const item of items) {
        try {
          const r = await exportItem({ ...item, profileId, api, parity: !opts['no-parity'], allowDecimate: opts['allow-decimate'] });
          results.push(r);
          if (opts.json) continue;
          if (r.blocked) {
            console.log(`${sym.fail} ${c.bold(r.id)} ${c.gray(`[${profileId}]`)} blocked: ${r.reason}`);
            for (const e of r.errors) {
              console.log(`    ${sym.fail} ${e.message} ${c.gray(`(${e.id})`)}`);
              if (e.hint) console.log(c.gray(`        fix: ${e.hint}`));
            }
          } else {
            const rep = r.report;
            const parity = r.parity ? ` · parity ${(r.parity.max * 100).toFixed(1)}%${r.parity.ok ? '' : c.yellow(' MISMATCH')}` : '';
            const warn = rep.counts.warning ? c.yellow(` · ${rep.counts.warning} warning(s)`) : '';
            console.log(`${sym.ok} ${c.bold(r.id)} ${c.gray(`[${profileId}]`)} → ${c.cyan(r.files.glb)} ${c.gray(`(${fmtBytes(rep.file.bytes)}, ${fmtNum(rep.triangles.total)} tris, ${rep.meshCount} mesh)`)}${parity}${warn}`);
          }
        } catch (err) {
          results.push({ ...item, profile: profileId, blocked: true, reason: err.message, errors: [] });
          if (!opts.json) console.log(`${sym.fail} ${item.variant ? `${item.slug}--${item.variant}` : item.slug} [${profileId}]\n  ${describeError(err, item.slug).split('\n').join('\n  ')}`);
        }
      }
    }
  };
  if (opts['no-parity']) await runAll(null);
  else await withCapture(runAll);
  const blocked = results.filter((r) => r.blocked);
  if (opts.json) {
    console.log(JSON.stringify({ results: results.map((r) => ({ id: r.id, profile: r.profile, blocked: r.blocked, reason: r.reason || null, files: r.files || null, parity: r.parity ? { max: r.parity.max, ok: r.parity.ok } : null, errors: r.errors || [] })) }, null, 2));
  } else {
    const done = results.length - blocked.length;
    console.log(`\n${done} exported${blocked.length ? c.red(`, ${blocked.length} blocked`) : ''}. Reports with import steps: exports/<profile>/<item>.report.md`);
  }
  return blocked.length ? 1 : 0;
}
