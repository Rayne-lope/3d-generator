// Build/export report: what is in the file, what changed for the engine, what to fix.

import { c, sym, fmtBytes, fmtNum, fmtMs } from './log.js';

const toSRGB8 = (v) => Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
const hex = (rgb) => `#${rgb.slice(0, 3).map((v) => toSRGB8(Math.min(1, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

const r5 = (v) => +v.toFixed(5);

/** Bounding box of one mesh node in asset space (file units). */
function meshBox(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const prim of mesh.primitives) {
    const p = prim.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    }
  }
  return { node: mesh.node, center: min.map((v, k) => r5((v + max[k]) / 2)), size: min.map((v, k) => r5(max[k] - v)) };
}

export function makeReport({ slug, variant, skin = null, id, def, setName, profile, glbPath, glbBytes, glbHash, info, ir, validation, sourceHash, parts = [], buildMs }) {
  const perMeter = profile.units.perMeter;
  const sizeUnits = info.bbox.size.map((v) => +v.toFixed(4));
  const sizeM = sizeUnits.map((v) => +(v / perMeter).toFixed(4));
  const texAnalysis = new Map((validation.textures || []).map((t) => [t.texture, t]));
  return {
    schema: 1,
    id,
    slug,
    variant: variant || null,
    skin: skin || null,
    skins: Object.keys(def.skins || {}),
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
    geometry: info.geometry,
    parts,
    // Markers in file units (the same units as bounds): what engines get as data.
    collision: ir.collision || 'default',
    attachments: (ir.attachments || []).map((a) => ({ name: a.name, node: a.node, position: a.position.map(r5), forward: a.forward, up: a.up, rotation: a.rotation, local: { position: a.local.position.map(r5), rotation: a.local.rotation } })),
    colliders: (ir.colliders || []).map((c) => ({ name: c.name, node: c.node, shape: c.shape, size: c.size.map(r5), position: c.position.map(r5), rotation: c.rotation, local: { position: c.local.position.map(r5), rotation: c.local.rotation } })),
    meshBounds: info.meshes.map(meshBox),
    nodes: info.nodes.map((n) => ({ name: n.name, parent: n.parent, translation: n.translation.map((v) => +v.toFixed(5)), partId: n.extras?.studio?.partId || null, hasMesh: n.hasMesh })),
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
  if (r.attachments?.length || r.colliders?.length || r.collision === 'none') {
    const bits = [];
    if (r.attachments?.length) bits.push(`${r.attachments.length} attachment${r.attachments.length === 1 ? '' : 's'} (${r.attachments.map((a) => a.name).join(', ')})`);
    if (r.colliders?.length) bits.push(`${r.colliders.length} collider${r.colliders.length === 1 ? '' : 's'} (${r.collision === 'bounds' ? 'bounds box' : r.colliders.map((x) => x.shape).join(', ')})`);
    if (r.collision === 'none') bits.push('no collision');
    lines.push(c.gray(`    markers: ${bits.join(' · ')}`));
  }
  const hidden = r.issues.length - shown.length;
  if (hidden > 0) lines.push(c.gray(`  ${hidden} info message(s) hidden (use --verbose)`));
  lines.push(c.gray(`  ${sym.arrow} ${r.file.path}`));
  return lines.join('\n');
}

/** Markdown export report. */
export function reportMarkdown(r) {
  const out = [];
  out.push(`# Export report — ${r.title}${r.variant ? ` (${r.variant})` : ''}${r.skin ? ` · skin ${r.skin}` : ''}`);
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
  if (r.attachments?.length || r.colliders?.length || r.collision === 'none') {
    const unit = r.profile.units.name;
    const v3 = (v) => v.map((x) => +x.toFixed(3)).join(', ');
    out.push('');
    out.push('## Attachments and collision');
    out.push('');
    if (r.collision === 'none') out.push('This asset is meant to have no collision.');
    if (r.attachments?.length) {
      out.push(`| Attachment | On node | Position (${unit}) | Forward |`);
      out.push('| --- | --- | --- | --- |');
      for (const a of r.attachments) out.push(`| ${a.name} | ${a.node} | ${v3(a.position)} | ${v3(a.forward)} |`);
      out.push('');
    }
    if (r.colliders?.length) {
      out.push(`| Collider | Shape | Size (${unit}) | Center (${unit}) |`);
      out.push('| --- | --- | --- | --- |');
      for (const x of r.colliders) out.push(`| ${x.name} | ${x.shape} | ${v3(x.size)} | ${v3(x.position)} |`);
      out.push('');
    }
    if (r.export?.setup) {
      out.push(`The same data is in \`${r.export.setup.json}\`.`);
      if (r.export.setup.rbxmx) {
        out.push('');
        out.push(`**Roblox:** after importing the GLB, open \`${r.export.setup.command}\`, copy all of it, paste it into the command bar (View > Command Bar) and press Enter. It works on the selected Model, or on the model named \`${r.id}\` in Workspace.`);
        out.push('');
        out.push('It checks the imported size first, then creates invisible collision Parts (folder `Collision`), turns collision off on the visual MeshParts and adds the Attachments. Running it again replaces what it made.');
        out.push('');
        out.push(`For scripts, the same code is a ModuleScript in \`${r.export.setup.rbxmx}\` (insert it with Insert from File): \`require(folder.AssetSetup).apply(model)\`.`);
      }
    }
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
