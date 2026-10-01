// Shared pieces for the version commands (save, revert, undo, diff).

import path from 'node:path';
import { buildItem } from '../core/build.js';
import { withCapture } from '../core/render/capture.js';
import { writeDataUrl } from '../core/render/image.js';
import { fmtNum } from '../core/log.js';
import { notifyServer } from './notify.js';

/** Build the generic preview of one asset and return its report (history stores generic GLBs). */
export async function buildGeneric(slug) {
  return (await buildItem({ slug, variant: null, profileId: 'generic' })).report;
}

/** Rebuild the generic previews after a restore and tell a running viewport to reload. */
export async function rebuildAfterRestore(t) {
  const items = [];
  for (const m of t.members) {
    try {
      const report = await buildGeneric(m);
      items.push({ slug: m, variant: null, profile: 'generic', ok: report.ok });
    } catch {
      // the restored code itself fails to build; the viewport shows the error on its own rebuild
    }
  }
  await notifyServer({ type: 'built', items });
  return items;
}

function statsLine(meta) {
  const s = Object.values(meta.stats);
  if (s.length === 1) return `${s[0].dimensions.map((v) => v.toFixed(2)).join(' × ')} m · ${fmtNum(s[0].triangles)} tris · ${s[0].materials} mat`;
  return `${s.length} assets · ${fmtNum(meta.triangles)} tris`;
}

/**
 * Write sheet.png (3 views, or a lineup for sets) and thumb.png into a version folder.
 * Rendered from the version's own GLB copies, so the picture always matches the snapshot.
 */
export async function renderVersionThumbnail(dir, t, meta) {
  const key = path.basename(path.dirname(dir));
  await withCapture(async (api) => {
    const base = `${api.url}files/history/${key}/${meta.id}/`;
    if (t.kind === 'asset') {
      const views = ['front', 'right', 'iso'];
      const r = await api.renderGLB({ url: `${base}generic.glb`, views, size: 320 });
      writeDataUrl(path.join(dir, 'thumb.png'), r.images.iso);
      const sheet = await api.sheet({
        tiles: views.map((v) => ({ image: r.images[v], label: v })),
        columns: 3,
        tileSize: 320,
        title: `${t.label} · ${meta.id}${meta.auto ? ' (auto-save)' : ''}`,
        lines: [meta.note ? `"${meta.note}"` : '', statsLine(meta)].filter(Boolean),
      });
      writeDataUrl(path.join(dir, 'sheet.png'), sheet);
    } else {
      const members = t.members.filter((m) => meta.stats[m]);
      const img = await api.lineup({ items: members.map((m) => ({ url: `${base}${m}.glb`, label: m })), width: 1200, height: 600 });
      writeDataUrl(path.join(dir, 'sheet.png'), img);
      writeDataUrl(path.join(dir, 'thumb.png'), img);
    }
  });
}

export function signed(n, digits = 0) {
  const v = Number(n.toFixed(digits));
  return `${v > 0 ? '+' : ''}${digits ? v.toFixed(digits) : fmtNum(v)}`;
}
