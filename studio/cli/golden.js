// node studio golden [--profile all|p] [--update-baselines] [--only a,b]

import { parse } from './args.js';
import { loadGolden, runGolden } from '../core/golden.js';
import { resolveProfiles } from '../profiles/index.js';
import { withCapture } from '../core/render/capture.js';
import { c, sym, fmtNum } from '../core/log.js';

const USAGE = `Usage: node studio golden [options]

Runs the golden set (golden/golden.json): every item and variant, in every profile, must pass
validate · determinism · structure · regression · parity. Writes golden/report/index.html and
exits with code 1 when anything fails. Run it after changing the kit, the exporter, a profile or
a golden asset.

Options:
  --profile <id>       generic | godot | roblox | all (default: the profiles in golden.json)
  --only <slugs>       comma list of golden assets
  --update-baselines   accept the current results as the new baselines + manifest
                       (only after checking the report: this is how regressions get approved)
  --json`;

export async function run(argv) {
  const { opts } = parse(argv, {
    profile: { type: 'string' },
    only: { type: 'string' },
    'update-baselines': { type: 'boolean', default: false },
  }, USAGE);
  const golden = loadGolden();
  const profiles = opts.profile ? resolveProfiles(opts.profile) : golden.profiles;
  const only = opts.only ? opts.only.split(',').map((s) => s.trim()) : null;
  const t0 = Date.now();
  const result = await withCapture((api) => runGolden(api, {
    profiles,
    update: opts['update-baselines'],
    only,
    onResult: (r) => {
      if (opts.json) return;
      const extra = [r.parity !== undefined ? `parity ${(r.parity * 100).toFixed(1)}%` : '', r.regression !== undefined ? `regression ${(r.regression * 100).toFixed(2)}%` : '', r.triangles ? `${fmtNum(r.triangles)} tris` : ''].filter(Boolean).join(' · ');
      console.log(`${r.ok ? sym.ok : sym.fail} ${c.bold(r.id)} ${c.gray(`[${r.profile}]`)} ${c.gray(extra)}`);
      for (const p of r.problems) console.log(`    ${c.red(p)}`);
    },
  }));
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const s = result.summary;
    console.log(`\n${s.failed ? sym.fail : sym.ok} golden: ${s.passed}/${s.total} passed (${Object.entries(s.byProfile).map(([p, x]) => `${p} ${x.passed}/${x.total}`).join(', ')}) in ${Math.round((Date.now() - t0) / 1000)}s`);
    if (result.updated) console.log(c.yellow('baselines and golden/manifest.json updated — review the images before committing them'));
    console.log(`report: ${c.cyan('golden/report/index.html')}`);
  }
  return result.summary.failed ? 1 : 0;
}
