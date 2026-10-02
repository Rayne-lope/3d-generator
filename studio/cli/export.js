// node studio export <slug|set:name|--all> --profile <generic|godot|roblox|all> [--skins]

import { parse } from './args.js';
import { resolveTargets } from '../core/targets.js';
import { resolveProfiles } from '../profiles/index.js';
import { exportItem } from '../core/export.js';
import { writeSkinPack } from '../core/skins.js';
import { loadAssetDef } from '../core/load-asset.js';
import { itemId } from '../core/paths.js';
import { describeError } from '../core/build.js';
import { withCapture } from '../core/render/capture.js';
import { c, sym, fmtBytes, fmtNum } from '../core/log.js';

const USAGE = `Usage: node studio export <slug | slug@skin | set:<name> | --all> --profile <id> [options]

Strict export to exports/<profile>/<slug>[--variant][@skin].glb with a .report.json and .report.md.
An item is exported only when:
  - the preflight finds 0 errors (fix them in the asset; never weaken a check),
  - a fresh rebuild reproduces the preview GLB byte for byte (Preview = Export),
and the source↔GLB parity render is recorded in the report (warning on mismatch).

Options:
  --profile <id>     generic | godot | roblox | all | comma list (required)
  --variant <name>   only this variant ('base' = no variant). Default: base + all variants
  --skins            also export every skin (exports/<profile>/<item>@<skin>.glb) and write the
                     skin pack exports/<profile>/<item>.skins/ (maps per look, skins.json;
                     Roblox: SurfaceAppearance maps + SkinSwitcher.lua; generic: one
                     KHR_materials_variants GLB with every look, <item>.skins.glb)
  --skin <name>      export one skin ('default' = base look)
  --all              every asset in assets/
  --no-parity        skip the parity render (no browser needed)
  --allow-decimate   let the Roblox triangle limit decimate oversized pieces
  --json`;

export async function run(argv) {
  const { args, opts } = parse(argv, {
    profile: { type: 'string' },
    variant: { type: 'string' },
    skin: { type: 'string' },
    skins: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    'no-parity': { type: 'boolean', default: false },
    'allow-decimate': { type: 'boolean', default: false },
  }, USAGE);
  if (!opts.profile) throw new Error(`export needs --profile (generic, godot, roblox or all)\n\n${USAGE}`);
  const profiles = resolveProfiles(opts.profile);
  const items = await resolveTargets(args, { all: opts.all, variant: opts.variant, skin: opts.skins ? 'all' : opts.skin });
  const results = [];
  const packs = [];
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
          results.push({ ...item, id: itemId(item.slug, item.variant, item.skin), profile: profileId, blocked: true, reason: err.message, errors: [] });
          if (!opts.json) console.log(`${sym.fail} ${itemId(item.slug, item.variant, item.skin)} [${profileId}]\n  ${describeError(err, item.slug).split('\n').join('\n  ')}`);
        }
      }
      if (opts.skins) await writePacks(profileId);
    }
  };
  // A skin pack is written when every look of an (asset, variant) exported in this profile.
  const writePacks = async (profileId) => {
    const groups = new Map();
    for (const it of items) {
      const key = `${it.slug}|${it.variant || ''}`;
      if (!groups.has(key)) groups.set(key, { slug: it.slug, variant: it.variant });
    }
    for (const g of groups.values()) {
      const def = await loadAssetDef(g.slug);
      const skins = Object.keys(def.skins || {});
      if (!skins.length) continue;
      const looks = results.filter((r) => r.profile === profileId && r.slug === g.slug && (r.variant || null) === (g.variant || null));
      const blocked = looks.filter((r) => r.blocked);
      const id = itemId(g.slug, g.variant);
      if (blocked.length || looks.length !== skins.length + 1) {
        packs.push({ id, profile: profileId, ok: false, reason: `${blocked.length || 'some'} look(s) not exported` });
        if (!opts.json) console.log(`${sym.fail} ${c.bold(`${id}.skins`)} ${c.gray(`[${profileId}]`)} skipped: every look must export first (${blocked.map((r) => r.id).join(', ')})`);
        continue;
      }
      try {
        const pack = await writeSkinPack({ slug: g.slug, variant: g.variant, profileId, title: def.meta.title, skins });
        packs.push({ id, profile: profileId, ok: true, dir: pack.dir, looks: pack.looks, variantsGlb: pack.variantsGlb });
        if (!opts.json) {
          console.log(`${sym.ok} ${c.bold(`${id}.skins`)} ${c.gray(`[${profileId}]`)} → ${c.cyan(pack.dir)} ${c.gray(`(${pack.looks.length} looks)`)}`);
          if (pack.variantsGlb) console.log(`  ${sym.ok} all looks in one GLB (KHR_materials_variants) → ${c.cyan(pack.variantsGlb)}`);
        }
      } catch (err) {
        packs.push({ id, profile: profileId, ok: false, reason: err.message });
        if (!opts.json) console.log(`${sym.fail} ${c.bold(`${id}.skins`)} ${c.gray(`[${profileId}]`)} ${err.message}`);
      }
    }
  };
  if (opts['no-parity']) await runAll(null);
  else await withCapture(runAll);
  const blocked = results.filter((r) => r.blocked);
  const badPacks = packs.filter((p) => !p.ok);
  if (opts.json) {
    console.log(JSON.stringify({ results: results.map((r) => ({ id: r.id, profile: r.profile, blocked: r.blocked, reason: r.reason || null, files: r.files || null, parity: r.parity ? { max: r.parity.max, ok: r.parity.ok } : null, errors: r.errors || [] })), skinPacks: packs }, null, 2));
  } else {
    const done = results.length - blocked.length;
    const packText = packs.length ? ` · ${packs.length - badPacks.length} skin pack(s)${badPacks.length ? c.red(`, ${badPacks.length} failed`) : ''}` : '';
    console.log(`\n${done} exported${blocked.length ? c.red(`, ${blocked.length} blocked`) : ''}${packText}. Reports with import steps: exports/<profile>/<item>.report.md`);
  }
  return blocked.length || badPacks.length ? 1 : 0;
}
