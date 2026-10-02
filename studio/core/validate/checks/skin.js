// Skin lock: a skin may change textures and material values, never the mesh. Engines swap
// skins on one model (Roblox SurfaceAppearance, glTF KHR_materials_variants, material
// overrides), which only works when every skin has the same nodes, triangles, UVs and
// material slots as the base look.

import { issue } from '../issues.js';

const HINT_GEOMETRY = 'Skins may only change textures, colors and finishes. Move shape changes (sizes, segments, parts, UV layout) into a variant, and keep atlas layouts and k.uv calls the same for every skin.';
const HINT_MATERIALS = 'Keep the same materials in the same order in every skin and give each one the same maps (a material cannot be flat in one skin and textured in another). Change colors and textures, not the material list.';

/** Material signature compared between skins: name, alpha mode and which maps it has. */
export function materialSlots(materials) {
  return materials.map((m) => ({ name: m.name, alphaMode: m.alphaMode, maps: Object.entries(m.maps || {}).filter(([, v]) => v).map(([k]) => k).sort() }));
}

/**
 * @param {{info: any, base: {skin: string, report: any}}} ctx
 *   info: inspection of the skin's GLB; base.report: the build report of the base look
 */
export function checkSkinLock({ info, base }) {
  const out = [];
  const { skin, report } = base;
  const baseGeo = report.geometry;
  if (!baseGeo) return out;
  const geo = info.geometry;
  if (geo.hash !== baseGeo.hash) {
    const baseMeshes = new Map(baseGeo.meshes.map((m) => [m.node, m]));
    const names = (list) => list.map((m) => m.node).join(', ');
    if (geo.meshes.length !== baseGeo.meshes.length || geo.meshes.some((m) => !baseMeshes.has(m.node))) {
      out.push(issue('skin.geometry-changed', 'error', `skin '${skin}' changes the mesh structure: meshes ${names(baseGeo.meshes) || '-'} → ${names(geo.meshes) || '-'}`, { hint: HINT_GEOMETRY, where: skin }));
    } else {
      const changed = [];
      for (const m of geo.meshes) {
        const b = baseMeshes.get(m.node);
        if (m.hash === b.hash) continue;
        const what = [];
        if (m.pos !== b.pos) what.push(m.triangles !== b.triangles ? `triangles ${b.triangles} → ${m.triangles}` : 'positions');
        if (m.nrm !== b.nrm) what.push('normals');
        if (m.uv !== b.uv) what.push('UVs');
        changed.push(`${m.node} (${what.join(', ')})`);
      }
      const detail = changed.length ? changed.slice(0, 6).join('; ') + (changed.length > 6 ? `; +${changed.length - 6} more` : '') : 'node transforms';
      out.push(issue('skin.geometry-changed', 'error', `skin '${skin}' changes the mesh compared with the base look: ${detail}`, { hint: HINT_GEOMETRY, where: skin }));
    }
  }
  const a = materialSlots(report.materials);
  const b = materialSlots(info.materials);
  const sig = (list) => list.map((m) => `${m.name}[${m.alphaMode}:${m.maps.join('+')}]`);
  const sa = sig(a);
  const sb = sig(b);
  if (sa.join('|') !== sb.join('|')) {
    const diffs = [];
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      if (sa[i] !== sb[i]) diffs.push(`${sa[i] || '(none)'} → ${sb[i] || '(none)'}`);
    }
    out.push(issue('skin.materials-changed', 'error', `skin '${skin}' changes the material slots: ${diffs.slice(0, 4).join('; ')}${diffs.length > 4 ? `; +${diffs.length - 4} more` : ''}`, { hint: HINT_MATERIALS, where: skin }));
  }
  return out;
}
