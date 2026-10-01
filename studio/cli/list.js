// node studio list

import fs from 'node:fs';
import { parse } from './args.js';
import { listAssets, listSets, loadSet } from '../core/targets.js';
import { loadAssetDef } from '../core/load-asset.js';
import { previewReport } from '../core/paths.js';
import { readJson } from '../core/fsutil.js';
import { table, c, fmtNum } from '../core/log.js';

const USAGE = 'Usage: node studio list [--json]';

export async function run(argv) {
  const { opts } = parse(argv, {}, USAGE);
  const assets = [];
  for (const slug of listAssets()) {
    let def = null;
    let error = null;
    try {
      def = await loadAssetDef(slug);
    } catch (err) {
      error = err.message;
    }
    const reportFile = previewReport(slug, null, 'generic');
    const report = fs.existsSync(reportFile) ? readJson(reportFile, null) : null;
    assets.push({
      slug,
      title: def?.meta.title || '?',
      category: def?.meta.category || '?',
      style: def?.meta.style || [],
      set: def?.meta.set || null,
      variants: def ? Object.keys(def.variants) : [],
      triangles: report?.triangles.total ?? null,
      ok: report ? report.ok : null,
      error,
    });
  }
  const sets = listSets().map((name) => ({ name, ...loadSet(name) }));
  if (opts.json) {
    console.log(JSON.stringify({ assets, sets }, null, 2));
    return 0;
  }
  console.log(table(assets.map((a) => [
    a.error ? c.red(a.slug) : a.slug,
    a.title,
    a.category,
    a.style.join(', '),
    a.set || '',
    a.variants.join(', '),
    a.triangles === null ? c.gray('not built') : fmtNum(a.triangles),
  ]), { header: ['slug', 'title', 'category', 'style', 'set', 'variants', 'tris'] }));
  if (sets.length) {
    console.log('');
    console.log(table(sets.map((s) => [s.name, s.title || '', s.members.join(', ')]), { header: ['set', 'title', 'members'] }));
  }
  return 0;
}
