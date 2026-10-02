// node studio publish <slug|set:name> --roblox [--user id | --group id] [--skins] [--dry-run] [--force] [--parity] [--json]

import { parse } from './args.js';
import { resolveTargets } from '../core/targets.js';
import { publishRoblox, insertSteps, registryFile } from '../core/publish.js';
import { loadCredentials, createClient, creatorLabel } from '../core/roblox-cloud.js';
import { withCapture } from '../core/render/capture.js';
import { paths, rel } from '../core/paths.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio publish <slug | set:<name> | --all> --roblox [options]

Uploads assets to Roblox with Open Cloud, so they appear in your Toolbox without a manual import:
  1. strict export with the Roblox profile (blocked by validation errors, like 'export'),
  2. upload the GLB as a Model asset, or a new version of it when it was published before
     (unchanged files are skipped; ids live in .studio/roblox/published.json),
  3. with --skins: export every skin, upload each SurfaceAppearance map once as an Image asset
     and write exports/roblox/<item>.skins.rbxmx (premade SurfaceAppearances per skin +
     SkinSwitcher) to insert into Studio.

Credentials (never printed or saved in reports):
  ROBLOX_API_KEY   Open Cloud API key with Assets API read + write (Creator Dashboard)
  ROBLOX_CREATOR   user:<userId> or group:<groupId>
  from the environment or a .env file in the project root (gitignored).

Options:
  --roblox          target Roblox (required; the only publish target for now)
  --user <id>       publish as this user (overrides ROBLOX_CREATOR)
  --group <id>      publish as this group (the key must belong to the group)
  --skins           also publish every skin (images + .skins.rbxmx)
  --variant <name>  only this variant ('base' = no variant). Default: base + all variants
  --dry-run         export and show what would be uploaded, without calling Roblox
  --force           upload a new model version even when the file did not change
  --parity          run the source↔GLB parity render during export (needs Chromium)
  --json`;

export async function run(argv) {
  const { args, opts } = parse(argv, {
    roblox: { type: 'boolean', default: false },
    user: { type: 'string' },
    group: { type: 'string' },
    skins: { type: 'boolean', default: false },
    variant: { type: 'string' },
    all: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    parity: { type: 'boolean', default: false },
  }, USAGE);
  if (!opts.roblox) throw new Error(`publish needs a target: --roblox\n\n${USAGE}`);
  if (opts.user && opts.group) throw new Error('pass --user or --group, not both');
  const dryRun = opts['dry-run'];
  const creds = loadCredentials({ root: paths.root, user: opts.user, group: opts.group });
  if (!dryRun) {
    const missing = [!creds.apiKey && 'ROBLOX_API_KEY', !creds.creator && 'ROBLOX_CREATOR (or --user/--group)'].filter(Boolean);
    if (missing.length) {
      throw new Error(`missing ${missing.join(' and ')}.\nSet them in the environment or in ${rel(paths.root) || '.'}/.env (gitignored), e.g.\n  ROBLOX_API_KEY=<key with Assets API read+write>\n  ROBLOX_CREATOR=user:123456\nSee docs/GUIDE.md → "Publish to Roblox". Use --dry-run to check everything else first.`);
    }
  }
  const items = (await resolveTargets(args, { all: opts.all, variant: opts.variant })).filter((i) => !i.skin);
  const client = dryRun ? null : createClient({ apiKey: creds.apiKey });
  const log = opts.json ? () => {} : (line) => console.log(line.replace(/^✓/, sym.ok).replace(/^✗/, sym.fail));
  if (!opts.json) {
    console.log(c.bold(`${dryRun ? 'Dry run: ' : ''}publishing ${items.length} item(s) to Roblox${creds.creator ? ` as ${creatorLabel(creds.creator)}` : ''}${opts.skins ? ' with skins' : ''}`));
    if (!dryRun) console.log(c.gray(`  API key from ${creds.sources.apiKey}, creator from ${creds.sources.creator}`));
  }
  const go = (api) => publishRoblox({ items, creator: creds.creator, client, dryRun, skins: opts.skins, force: opts.force, api, log });
  const results = opts.parity ? await withCapture(go) : await go(null);
  const failed = results.filter((r) => r.problems.length);
  if (opts.json) {
    console.log(JSON.stringify({ dryRun, registry: rel(registryFile()), results: results.map((r) => ({ ...r, insert: insertSteps(r) })) }, null, 2));
  } else {
    for (const r of results) {
      if (r.dryRun || !r.model?.assetId) continue;
      console.log(`\n${c.bold(r.title)} (${r.id})`);
      for (const s of insertSteps(r)) console.log(`  - ${s}`);
      if (r.file) console.log(c.gray(`  details: ${r.file}`));
    }
    if (!dryRun && client) console.log(c.gray(`\n${client.requests} Open Cloud request(s).`));
    if (failed.length) console.log(c.red(`\n${failed.length} item(s) had problems: ${failed.map((r) => `${r.id} (${r.problems.join('; ')})`).join(', ')}`));
  }
  return failed.length ? 1 : 0;
}
