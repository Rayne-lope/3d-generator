// node studio new <slug> [--prompt "..."] [--title "..."] [--category prop] [--set name] [--style a,b]

import fs from 'node:fs';
import path from 'node:path';
import { parse } from './args.js';
import { paths, assetDir, assetFile, rel } from '../core/paths.js';
import { isValidSlug } from '../core/targets.js';
import { ensureDir, readJson, writeJson } from '../core/fsutil.js';
import { hashString } from '../kit/rng.js';
import { c, sym } from '../core/log.js';

const USAGE = `Usage: node studio new <slug> [options]

Creates assets/<slug>/asset.js from the template (a placeholder that already builds).

Options:
  --prompt <text>    the user's prompt, stored verbatim in meta.prompt
  --title <text>     display title (default: from slug)
  --category <c>     prop | furniture | container | architecture | environment | nature | vehicle | weapon | lighting | decor | modular
  --style <list>     comma-separated style keywords from the prompt
  --set <name>       mark the asset as a member of sets/<name>
  --force            overwrite an existing asset`;

export function titleFromSlug(slug) {
  return slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export function scaffoldAsset({ slug, prompt = '', title, category = 'prop', style = [], set = null, force = false }) {
  if (!isValidSlug(slug)) throw new Error(`invalid slug '${slug}': use lowercase letters, digits and single dashes (e.g. wooden-barrel)`);
  const file = assetFile(slug);
  if (fs.existsSync(file) && !force) throw new Error(`assets/${slug}/asset.js already exists (use --force to overwrite)`);
  const tpl = fs.readFileSync(path.join(paths.templates, 'asset.js.tpl'), 'utf8');
  const t = title || titleFromSlug(slug);
  const content = tpl
    .replaceAll('{{TITLE}}', t.replace(/'/g, "\\'"))
    .replaceAll('{{PROMPT}}', prompt.replace(/\n/g, ' ') || '(none)')
    .replaceAll('{{PROMPT_JSON}}', JSON.stringify(prompt))
    .replaceAll('{{STYLE_JSON}}', JSON.stringify(style))
    .replaceAll('{{CATEGORY}}', category)
    .replaceAll('{{SET_LINE}}', set ? `\n    set: '${set}',` : '')
    .replaceAll('{{SEED}}', String(hashString(slug) % 100000))
    .replaceAll('{{SLUG_NAME}}', slug.replace(/[^a-z0-9]+/gi, '_'));
  ensureDir(assetDir(slug));
  fs.writeFileSync(file, content);
  const m = readJson(paths.metrics, { assets: {} });
  m.assets[slug] = { ...(m.assets[slug] || {}), createdAt: new Date().toISOString(), prompt };
  writeJson(paths.metrics, m);
  return file;
}

export async function run(argv) {
  const { args, opts } = parse(argv, {
    prompt: { type: 'string', default: '' },
    title: { type: 'string' },
    category: { type: 'string', default: 'prop' },
    style: { type: 'string', default: '' },
    set: { type: 'string' },
    force: { type: 'boolean', default: false },
  }, USAGE);
  const slug = args[0];
  if (!slug) throw new Error(USAGE);
  const file = scaffoldAsset({ slug, prompt: opts.prompt, title: opts.title, category: opts.category, style: opts.style ? opts.style.split(',').map((s) => s.trim()).filter(Boolean) : [], set: opts.set, force: opts.force });
  if (opts.json) console.log(JSON.stringify({ slug, file: rel(file) }));
  else {
    console.log(`${sym.ok} created ${c.bold(rel(file))}`);
    console.log(c.gray(`  next: edit build(), then  node studio review ${slug}`));
  }
  return 0;
}
