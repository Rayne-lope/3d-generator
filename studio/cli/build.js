// node studio build <slug|set:name|--all> [--profile p|all] [--variant v] [--force]

import { parse } from './args.js';
import { resolveTargets } from '../core/targets.js';
import { resolveProfiles } from '../profiles/index.js';
import { buildItem, describeError } from '../core/build.js';
import { formatReport } from '../core/report.js';
import { loadConfig } from '../core/config.js';
import { c, sym } from '../core/log.js';
import { notifyServer } from './notify.js';

const USAGE = `Usage: node studio build <slug | set:<name> | --all> [options]

Builds the preview GLB for each target and profile, validates it and prints a report.
The preview file is exactly what 'export' writes (Preview = Export).

Options:
  --profile <id>     generic | godot | roblox | all | comma list (default: config.defaultProfile)
  --variant <name>   only this variant ('base' = no variant). Default: base + all variants
  --all              every asset in assets/
  --force            ignore the build cache
  --strict           exit with code 1 when any validation error is found
  --allow-decimate   let the Roblox triangle limit decimate oversized pieces
  --verbose, -v      show info messages, notes and hints
  --json             machine-readable output`;

export async function run(argv) {
  const { args, opts } = parse(argv, {
    profile: { type: 'string' },
    variant: { type: 'string' },
    all: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    'allow-decimate': { type: 'boolean', default: false },
  }, USAGE);
  const config = loadConfig();
  const profiles = resolveProfiles(opts.profile, config.defaultProfile);
  const items = await resolveTargets(args, { all: opts.all, variant: opts.variant });
  const results = [];
  let failed = 0;
  let errors = 0;
  for (const item of items) {
    for (const profileId of profiles) {
      try {
        const { report, cached } = await buildItem({ ...item, profileId, force: opts.force, allowDecimate: opts['allow-decimate'] });
        results.push({ ...item, profile: profileId, ok: report.ok, counts: report.counts, file: report.file.path, cached, report: opts.json ? report : undefined });
        errors += report.counts.error;
        if (!opts.json) console.log(formatReport(report, { verbose: opts.verbose }) + (cached ? c.gray('  (cached)') : ''));
      } catch (err) {
        failed++;
        results.push({ ...item, profile: profileId, ok: false, error: err.message });
        if (!opts.json) console.log(`${sym.fail} ${c.bold(item.variant ? `${item.slug}--${item.variant}` : item.slug)} ${c.gray(`[${profileId}]`)}\n  ${describeError(err, item.slug).split('\n').join('\n  ')}`);
        if (process.env.STUDIO_DEBUG) console.error(err.stack);
      }
    }
  }
  await notifyServer({ type: 'built', items: results.map((r) => ({ slug: r.slug, variant: r.variant, profile: r.profile, ok: r.ok })) });
  if (opts.json) console.log(JSON.stringify({ results }, null, 2));
  else if (errors) console.log(c.yellow(`\n${errors} validation error(s) would block 'export'. Fix them before exporting.`));
  if (failed) return 1;
  if (opts.strict && errors) return 1;
  return 0;
}
