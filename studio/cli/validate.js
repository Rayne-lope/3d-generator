// node studio validate <slug|set:name|--all> [--profile p|all]  — export preflight, no files exported

import { parse } from './args.js';
import { resolveTargets } from '../core/targets.js';
import { resolveProfiles } from '../profiles/index.js';
import { buildItem, describeError } from '../core/build.js';
import { loadConfig } from '../core/config.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio validate <slug | set:<name> | --all> [--profile <id|all>] [--verbose] [--json]

Runs the export preflight (Khronos glTF validator + studio checks) on the exact file that
'export' would write, and exits with code 1 if anything would block the export.`;

export async function run(argv) {
  const { args, opts } = parse(argv, { profile: { type: 'string' }, variant: { type: 'string' }, all: { type: 'boolean', default: false } }, USAGE);
  const profiles = resolveProfiles(opts.profile, loadConfig().defaultProfile);
  const items = await resolveTargets(args, { all: opts.all, variant: opts.variant });
  const results = [];
  let blocked = 0;
  for (const item of items) {
    for (const profileId of profiles) {
      const id = item.variant ? `${item.slug}--${item.variant}` : item.slug;
      try {
        const { report } = await buildItem({ ...item, profileId });
        const shown = report.issues.filter((i) => opts.verbose || i.severity !== 'info');
        results.push({ id, profile: profileId, ok: report.ok, counts: report.counts, issues: report.issues });
        if (!report.ok) blocked++;
        if (!opts.json) {
          console.log(`${report.ok ? sym.ok : sym.fail} ${c.bold(id)} ${c.gray(`[${profileId}]`)} ${report.counts.error} errors, ${report.counts.warning} warnings`);
          for (const i of shown) console.log(`   ${i.severity === 'error' ? sym.fail : i.severity === 'warning' ? sym.warn : sym.info} ${i.message} ${c.gray(`(${i.id})`)}${i.hint && i.severity === 'error' ? `\n      ${c.gray(`fix: ${i.hint}`)}` : ''}`);
        }
      } catch (err) {
        blocked++;
        results.push({ id, profile: profileId, ok: false, error: err.message });
        if (!opts.json) console.log(`${sym.fail} ${c.bold(id)} ${c.gray(`[${profileId}]`)}\n   ${describeError(err, item.slug).split('\n').join('\n   ')}`);
      }
    }
  }
  if (opts.json) console.log(JSON.stringify({ results, blocked }, null, 2));
  else console.log(blocked ? c.red(`\n${blocked} item(s) would be blocked at export.`) : c.green('\nAll items pass the export preflight.'));
  return blocked ? 1 : 0;
}
