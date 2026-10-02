// node studio report <slug[--variant][@skin]> [--profile p] [--variant v] [--skin s] [--md] [--export]

import fs from 'node:fs';
import { parse } from './args.js';
import { buildItem } from '../core/build.js';
import { exportPaths } from '../core/export.js';
import { formatReport, reportMarkdown } from '../core/report.js';
import { readJson } from '../core/fsutil.js';
import { loadConfig } from '../core/config.js';
import { parseItemId } from '../core/paths.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio report <slug[--variant][@skin]> [options]

Shows the full report of the current preview build (rebuilt if the source changed): size,
triangles per mesh, materials, textures with texel density and UV padding, engine conversions,
issues with fixes, parity and the engine import steps.

Options:
  --profile <id>    generic | godot | roblox (default: config.defaultProfile)
  --variant <name>  a variant of the asset (or use <slug>--<variant>)
  --skin <name>     a skin of the asset (or use <slug>@<skin>)
  --export          show the report of the last export (exports/<profile>/...) instead
  --md              print the Markdown version (what export writes to .report.md)
  --json`;

export async function run(argv) {
  const { args, opts } = parse(argv, {
    profile: { type: 'string' },
    variant: { type: 'string' },
    skin: { type: 'string' },
    export: { type: 'boolean', default: false },
    md: { type: 'boolean', default: false },
  }, USAGE);
  if (args.length !== 1) throw new Error(USAGE);
  const parsed = parseItemId(args[0]);
  if (!parsed) throw new Error(`not an item id: ${args[0]}\n\n${USAGE}`);
  const { slug } = parsed;
  const variant = opts.variant ? (opts.variant === 'base' ? null : opts.variant) : parsed.variant;
  const skin = opts.skin ? (opts.skin === 'default' ? null : opts.skin) : parsed.skin;
  const profileId = opts.profile || loadConfig().defaultProfile;
  let report;
  if (opts.export) {
    const file = exportPaths(slug, variant, profileId, skin).json;
    if (!fs.existsSync(file)) throw new Error(`no export yet for ${args[0]} [${profileId}] — run: node studio export ${args[0]} --profile ${profileId}`);
    report = readJson(file);
  } else {
    report = (await buildItem({ slug, variant, skin, profileId })).report;
  }
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  if (opts.md) {
    console.log(reportMarkdown(report));
    return 0;
  }
  console.log(formatReport(report, { verbose: true }));
  if (report.parity) console.log(`  ${report.parity.ok ? sym.ok : sym.warn} parity source↔GLB: max ${(report.parity.max * 100).toFixed(2)}% (limit ${(report.parity.threshold * 100).toFixed(1)}%)`);
  else console.log(c.gray(`  parity not measured yet (node studio review ${args[0]} --profile ${profileId})`));
  if (report.export) console.log(`  ${sym.ok} exported ${report.export.exportedAt} → ${report.file.path}`);
  if (report.importHints?.length) {
    console.log(`\n${c.bold(`Importing into ${report.profile.label}:`)}`);
    for (const h of report.importHints) console.log(`  - ${h}`);
  }
  return report.ok ? 0 : 1;
}
