// Build/export report: what is in the file, what changed for the engine, what to fix.

import { c, sym, fmtBytes, fmtNum, fmtMs } from './log.js';

const toSRGB8 = (v) => Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
const hex = (rgb) => `#${rgb.slice(0, 3).map((v) => toSRGB8(Math.min(1, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

export function makeReport({ slug, variant, id, def, setName, profile, glbPath, glbBytes, glbHash, info, ir, validation, sourceHash, buildMs }) {
  const perMeter = profile.units.perMeter;
  const sizeUnits = info.bbox.size.map((v) => +v.toFixed(4));
  const sizeM = sizeUnits.map((v) => +(v / perMeter).toFixed(4));
  const texAnalysis = new Map((validation.textures || []).map((t) => [t.texture, t]));
  return {
    schema: 1,
    id,
    slug,
    variant: variant || null,
    title: def.meta.title,
    prompt: def.meta.prompt || '',
    interpretation: def.meta.interpretation || '',
    category: def.meta.category,
    style: def.meta.style || [],
    set: setName || null,
    profile: { id: profile.id, label: profile.label, units: { name: profile.units.name, perMeter } },
    ok: validation.counts.error === 0,
    counts: validation.counts,
    file: { path: glbPath, bytes: glbBytes, sha256: glbHash },
    dimensions: { meters: sizeM, units: sizeUnits, unitName: profile.units.name, studs: sizeM.map((v) => +(v / 0.28).toFixed(2)) },
    bounds: { min: info.bbox.min.map((v) => +v.toFixed(5)), max: info.bbox.max.map((v) => +v.toFixed(5)) },
    triangles: {
      total: info.triangles,
      budget: def.meta.budget?.triangles || null,
      perMesh: info.meshes.map((m) => ({ node: m.node, triangles: m.triangles, materials: [...new Set(m.primitives.map((p) => info.materials[p.material]?.name))] })),
      perPart: ir.stats?.partTriangles || {},
    },
    meshCount: info.meshes.length,
    nodes: info.nodes.map((n) => ({ name: n.name, parent: n.parent, translation: n.translation.map((v) => +v.toFixed(5)), hasMesh: n.hasMesh })),
    materials: info.materials.map((m) => ({
      name: m.name,
      baseColor: hex(m.baseColor),
      alpha: +m.baseColor[3].toFixed(3),
      metallic: +m.metallic.toFixed(3),
      roughness: +m.roughness.toFixed(3),
      emissive: m.emissive.some((v) => v > 0) ? hex(m.emissive) : null,
      emissiveStrength: m.emissiveStrength,
      alphaMode: m.alphaMode,
      maps: Object.fromEntries(Object.entries(m.maps).filter(([, v]) => v).map(([k, v]) => [k, info.textures[v.texture].name])),
    })),
    palette: (ir.materials || []).filter((m) => m.palette).map((m) => ({ material: m.name, swatches: m.palette })),
    textures: info.textures.map((t, i) => ({ name: t.name, width: t.width, height: t.height, bytes: t.bytes, slots: t.slots, ...(texAnalysis.get(i) ? stripIndex(texAnalysis.get(i)) : {}) })),
    issues: validation.issues,
    khronos: validation.khronos,
    notes: ir.notes || [],
    hashes: { source: sourceHash, glb: glbHash },
    timing: { buildMs: Math.round(buildMs) },
    builtAt: new Date().toISOString(),
    importHints: profile.importHints || [],
  };
}

function stripIndex(t) {
  const { texture, name, width, height, ...rest } = t;
  void texture; void name; void width; void height;
  return rest;
}

/** Human-readable multi-line summary for the terminal. */
export function formatReport(r, { verbose = false } = {}) {
  const lines = [];
  const status = r.counts.error ? sym.fail : r.counts.warning ? sym.warn : sym.ok;
  const head = `${status} ${c.bold(r.id)} ${c.gray(`[${r.profile.id}]`)} ${c.gray(fmtMs(r.timing.buildMs))}`;
  lines.push(head);
  const d = r.dimensions;
  const dims = `${d.meters.map((v) => v.toFixed(2)).join(' × ')} m${r.profile.id === 'roblox' ? ` (${d.units.map((v) => v.toFixed(1)).join(' × ')} studs)` : ''}`;
  const budget = r.triangles.budget ? ` / budget ${fmtNum(r.triangles.budget)}` : '';
  lines.push(`  ${dims} · ${fmtNum(r.triangles.total)} tris${budget} · ${r.meshCount} mesh${r.meshCount === 1 ? '' : 'es'} · ${r.materials.length} material${r.materials.length === 1 ? '' : 's'} · ${r.textures.length} texture${r.textures.length === 1 ? '' : 's'} · ${fmtBytes(r.file.bytes)}`);
  for (const t of r.textures) {
    const bits = [`${t.width}×${t.height}`];
    if (t.layout) bits.push(t.layout);
    if (t.texelDensity) bits.push(`${t.texelDensity} px/m`);
    if (t.minPaddingPx !== undefined && t.minPaddingPx !== null) bits.push(`padding ${t.minPaddingPx}px`);
    if (verbose || t.texelDensity || t.minPaddingPx !== undefined) lines.push(c.gray(`    texture ${t.name}: ${bits.join(', ')}`));
  }
  if (verbose) for (const n of r.notes) lines.push(c.gray(`    note: ${n.message}`));
  const shown = r.issues.filter((i) => verbose || i.severity !== 'info');
  for (const i of shown) {
    const s = i.severity === 'error' ? sym.fail : i.severity === 'warning' ? sym.warn : sym.info;
    lines.push(`  ${s} ${i.message} ${c.gray(`(${i.id})`)}`);
    if (i.hint && (verbose || i.severity === 'error')) lines.push(c.gray(`      fix: ${i.hint}`));
  }
  const hidden = r.issues.length - shown.length;
  if (hidden > 0) lines.push(c.gray(`  ${hidden} info message(s) hidden (use --verbose)`));
  lines.push(c.gray(`  ${sym.arrow} ${r.file.path}`));
  return lines.join('\n');
}

/** Markdown export report. */
export function reportMarkdown(r) {
  const out = [];
  out.push(`# Export report — ${r.title}${r.variant ? ` (${r.variant})` : ''}`);
  out.push('');
  out.push(`- **Profile:** ${r.profile.label} (\`${r.profile.id}\`)`);
  out.push(`- **File:** \`${r.file.path}\` (${fmtBytes(r.file.bytes)}, sha256 \`${r.file.sha256.slice(0, 12)}…\`)`);
  out.push(`- **Status:** ${r.ok ? 'passed preflight' : 'BLOCKED by errors'} — ${r.counts.error} errors, ${r.counts.warning} warnings, ${r.counts.info} info`);
  out.push(`- **Dimensions:** ${r.dimensions.meters.map((v) => v.toFixed(3)).join(' × ')} m (${r.dimensions.studs.map((v) => v.toFixed(1)).join(' × ')} studs)${r.profile.units.name !== 'm' ? ` — file units: ${r.profile.units.name}` : ''}`);
  out.push(`- **Triangles:** ${fmtNum(r.triangles.total)}${r.triangles.budget ? ` (budget ${fmtNum(r.triangles.budget)})` : ''} in ${r.meshCount} mesh(es)`);
  if (r.prompt) out.push(`- **Prompt:** ${r.prompt}`);
  if (r.export) out.push(`- **Preview = Export:** a fresh rebuild reproduced the preview byte for byte (exported ${r.export.exportedAt})`);
  if (r.parity) out.push(`- **Parity (source scene ↔ GLB):** max ${(r.parity.max * 100).toFixed(2)}% of object pixels differ — ${r.parity.ok ? 'OK' : 'MISMATCH'} (limit ${(r.parity.threshold * 100).toFixed(1)}%)`);
  out.push('');
  out.push('## Meshes');
  out.push('');
  out.push('| Node | Triangles | Materials |');
  out.push('| --- | ---: | --- |');
  for (const m of r.triangles.perMesh) out.push(`| ${m.node} | ${fmtNum(m.triangles)} | ${m.materials.join(', ')} |`);
  out.push('');
  out.push('## Materials');
  out.push('');
  out.push('| Material | Base color | Metallic | Roughness | Alpha | Maps |');
  out.push('| --- | --- | ---: | ---: | --- | --- |');
  for (const m of r.materials) out.push(`| ${m.name} | \`${m.baseColor}\` | ${m.metallic} | ${m.roughness} | ${m.alphaMode} | ${Object.entries(m.maps).map(([k, v]) => `${k}: ${v}`).join('<br>') || '—'} |`);
  if (r.textures.length) {
    out.push('');
    out.push('## Textures');
    out.push('');
    out.push('| Texture | Size | Layout | Texel density | UV padding |');
    out.push('| --- | --- | --- | ---: | ---: |');
    for (const t of r.textures) out.push(`| ${t.name} | ${t.width}×${t.height} | ${t.layout || '—'} | ${t.texelDensity ? `${t.texelDensity} px/m` : '—'} | ${t.minPaddingPx !== undefined && t.minPaddingPx !== null ? `${t.minPaddingPx}px (needs ${t.requiredPaddingPx}px)` : '—'} |`);
  }
  if (r.notes.length) {
    out.push('');
    out.push('## Engine conversions');
    out.push('');
    for (const n of r.notes) out.push(`- ${n.message}`);
  }
  out.push('');
  out.push('## Issues');
  out.push('');
  if (!r.issues.length) out.push('None.');
  for (const i of r.issues) out.push(`- **${i.severity}** \`${i.id}\` — ${i.message}${i.hint ? `  \n  _Fix:_ ${i.hint}` : ''}`);
  if (r.importHints.length) {
    out.push('');
    out.push(`## Importing into ${r.profile.label}`);
    out.push('');
    for (const h of r.importHints) out.push(`- ${h}`);
  }
  out.push('');
  return out.join('\n');
}
