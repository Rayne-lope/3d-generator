// node studio new-set <set> --members a,b,c [--prompt "..."] [--title "..."] [--style a,b]

import fs from 'node:fs';
import path from 'node:path';
import { parse } from './args.js';
import { paths, assetDir, assetFile, rel } from '../core/paths.js';
import { isValidSlug } from '../core/targets.js';
import { ensureDir, readJson, writeJson } from '../core/fsutil.js';
import { hashString } from '../kit/rng.js';
import { titleFromSlug } from './new.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio new-set <set> --members <a,b,c> [options]

Creates a set (pack) made from one prompt:
  sets/<set>/set.json   title, prompt, style, member list
  sets/<set>/style.js   shared palette, materials and dimensions
  assets/<set>-<member>/asset.js for every member (imports the shared style)

Options:
  --members <list>   member names (e.g. table,stool,mug); prefixed with the set name
  --prompt <text>    the user's prompt for the whole set
  --title <text>     set title
  --style <list>     style keywords
  --category <c>     default category for members (default: prop)
  --force            overwrite existing files`;

function fill(tpl, vars) {
  let out = tpl;
  for (const [key, value] of Object.entries(vars)) out = out.replaceAll(`{{${key}}}`, value);
  return out;
}

export async function run(argv) {
  const { args, opts } = parse(argv, {
    members: { type: 'string', default: '' },
    prompt: { type: 'string', default: '' },
    title: { type: 'string' },
    style: { type: 'string', default: '' },
    category: { type: 'string', default: 'prop' },
    force: { type: 'boolean', default: false },
  }, USAGE);
  const set = args[0];
  if (!set || !isValidSlug(set)) throw new Error(`invalid or missing set name\n\n${USAGE}`);
  const members = opts.members.split(',').map((m) => m.trim()).filter(Boolean);
  if (!members.length) throw new Error(`--members is required\n\n${USAGE}`);
  const slugs = members.map((m) => (m.startsWith(`${set}-`) ? m : `${set}-${m}`));
  for (const s of slugs) if (!isValidSlug(s)) throw new Error(`invalid member slug '${s}'`);
  const setDir = path.join(paths.sets, set);
  if (fs.existsSync(path.join(setDir, 'set.json')) && !opts.force) throw new Error(`sets/${set} already exists (use --force)`);
  const style = opts.style ? opts.style.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const title = opts.title || titleFromSlug(set);
  ensureDir(setDir);
  writeJson(path.join(setDir, 'set.json'), { title, prompt: opts.prompt, interpretation: '', style, members: slugs });
  const vars = { SET: set, TITLE: title, PROMPT: opts.prompt || '(none)' };
  fs.writeFileSync(path.join(setDir, 'style.js'), fill(fs.readFileSync(path.join(paths.templates, 'style.js.tpl'), 'utf8'), vars));
  const memberTpl = fs.readFileSync(path.join(paths.templates, 'member.js.tpl'), 'utf8');
  const created = [rel(path.join(setDir, 'set.json')), rel(path.join(setDir, 'style.js'))];
  const metrics = readJson(paths.metrics, { assets: {} });
  for (const slug of slugs) {
    if (fs.existsSync(assetFile(slug)) && !opts.force) throw new Error(`assets/${slug} already exists (use --force)`);
    ensureDir(assetDir(slug));
    fs.writeFileSync(assetFile(slug), fill(memberTpl, {
      SET: set,
      TITLE: titleFromSlug(slug.slice(set.length + 1)),
      PROMPT: opts.prompt.replace(/\n/g, ' ') || '(none)',
      PROMPT_JSON: JSON.stringify(opts.prompt),
      STYLE_JSON: JSON.stringify(style),
      CATEGORY: opts.category,
      SEED: String(hashString(slug) % 100000),
      SLUG_NAME: slug.replace(/[^a-z0-9]+/gi, '_'),
    }));
    metrics.assets[slug] = { ...(metrics.assets[slug] || {}), createdAt: new Date().toISOString(), prompt: opts.prompt, set };
    created.push(rel(assetFile(slug)));
  }
  writeJson(paths.metrics, metrics);
  if (opts.json) console.log(JSON.stringify({ set, members: slugs, created }, null, 2));
  else {
    console.log(`${sym.ok} set ${c.bold(set)} with ${slugs.length} members`);
    for (const f of created) console.log(c.gray(`  + ${f}`));
    console.log(c.gray(`  next: shape the shared style in sets/${set}/style.js, then  node studio review set:${set}`));
  }
  return 0;
}
