// node studio review <slug|set:name|--all> [--profile p] [--no-parity] [--variant v] [--skins | --skin s]

import path from 'node:path';
import { parse } from './args.js';
import { resolveTargets } from '../core/targets.js';
import { resolveProfiles } from '../profiles/index.js';
import { withCapture } from '../core/render/capture.js';
import { reviewItem, lineup, skinSheet } from '../core/review.js';
import { formatReport } from '../core/report.js';
import { describeError } from '../core/build.js';
import { loadConfig } from '../core/config.js';
import { paths, itemId } from '../core/paths.js';
import { loadAssetDef } from '../core/load-asset.js';
import { c, sym } from '../core/log.js';
import { notifyServer } from './notify.js';

const USAGE = `Usage: node studio review <slug | slug@skin | set:<name> | --all> [options]

Builds, then renders the exported GLB from several angles into one contact sheet
(.studio/shots/<item>/<profile>/sheet.png) and compares it against the source scene
(parity). Open the sheet image to judge the asset against the prompt and rules/.

Options:
  --profile <id>    generic | godot | roblox | all (default: config.defaultProfile)
  --variant <name>  only this variant ('base' = no variant)
  --skins           also review every skin, and write a skin sheet with all looks from the
                    same cameras (.studio/shots/<item>/<profile>/skins.png)
  --skin <name>     review one skin ('default' = base look)
  --views <list>    comma list (default: front,right,back,top,iso,iso-wire)
  --size <px>       tile size (default 512)
  --no-parity       skip the source-vs-GLB comparison
  --force           ignore the build cache
  --json`;

export async function run(argv) {
  const { args, opts } = parse(argv, {
    profile: { type: 'string' },
    variant: { type: 'string' },
    skin: { type: 'string' },
    skins: { type: 'boolean', default: false },
    views: { type: 'string' },
    size: { type: 'string' },
    'no-parity': { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  }, USAGE);
  const config = loadConfig();
  const profiles = resolveProfiles(opts.profile, config.defaultProfile);
  const items = await resolveTargets(args, { all: opts.all, variant: opts.variant, skin: opts.skins ? 'all' : opts.skin });
  const results = [];
  results.skinSheets = [];
  let failed = 0;
  await withCapture(async (api) => {
    for (const profileId of profiles) {
      for (const item of items) {
        try {
          const r = await reviewItem(api, { ...item, profileId, parity: !opts['no-parity'], views: opts.views ? opts.views.split(',') : undefined, size: opts.size ? Number(opts.size) : undefined, force: opts.force });
          results.push(r);
          if (!opts.json) {
            console.log(formatReport(r.report, { verbose: opts.verbose }));
            if (r.parity) console.log(`  ${r.parity.ok ? sym.ok : sym.warn} parity source↔GLB: max ${(r.parity.max * 100).toFixed(2)}% (${Object.entries(r.parity.views).map(([v, x]) => `${v} ${(x * 100).toFixed(1)}%`).join(', ')})`);
            console.log(`  ${c.bold('review sheet:')} ${c.cyan(r.sheet)}`);
          }
        } catch (err) {
          failed++;
          results.push({ ...item, profile: profileId, error: err.message });
          if (!opts.json) console.log(`${sym.fail} ${itemId(item.slug, item.variant, item.skin)} [${profileId}]\n  ${describeError(err, item.slug).split('\n').join('\n  ')}`);
        }
      }
      if (opts.skins) {
        // One skin sheet per reviewed (asset, variant) that has skins and built without crashing.
        const groups = new Map();
        for (const r of results) if (r.profile === profileId && !r.error) groups.set(`${r.slug}|${r.variant || ''}`, r);
        for (const r of groups.values()) {
          const skins = Object.keys((await loadAssetDef(r.slug)).skins || {});
          const built = skins.filter((s) => results.some((x) => x.profile === profileId && !x.error && x.slug === r.slug && x.variant === r.variant && x.skin === s));
          if (!built.length) continue;
          const file = await skinSheet(api, { slug: r.slug, variant: r.variant, profileId, skins: built });
          results.skinSheets.push({ slug: r.slug, variant: r.variant, profile: profileId, file });
          if (!opts.json) console.log(`\n${c.bold('skin sheet:')} ${c.cyan(file)}`);
        }
      }
      // Lineups compare different assets or variants; skins have their own sheet.
      const ok = results.filter((r) => r.profile === profileId && !r.error && !r.skin);
      if (ok.length > 1) {
        const name = args.length === 1 ? args[0].replace(':', '-') : 'lineup';
        const file = await lineup(api, ok, profileId, path.join(paths.shots, `_lineup-${name}`, `${profileId}.png`));
        if (!opts.json) console.log(`\n${c.bold('lineup:')} ${c.cyan(file)}`);
        results.lineup = file;
      }
    }
  });
  await notifyServer({ type: 'built', items: results.filter((r) => !r.error).map((r) => ({ slug: r.slug, variant: r.variant, skin: r.skin || null, profile: r.profile, ok: r.report.ok })) });
  if (opts.json) console.log(JSON.stringify({ results: results.map((r) => ({ ...r, report: r.report ? { ok: r.report.ok, counts: r.report.counts, triangles: r.report.triangles.total, issues: r.report.issues } : undefined })), lineup: results.lineup || null, skinSheets: results.skinSheets }, null, 2));
  return failed ? 1 : 0;
}
