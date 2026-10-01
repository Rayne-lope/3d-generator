// Material checks: portable features only, plausible PBR values, and warnings for looks
// that depend on viewport tricks (reflections) rather than on the asset itself.

import { issue, policy } from '../issues.js';

const toSRGB = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * @param {{info: any, profile: any, sourceMaterials: any[]}} ctx
 * sourceMaterials are the authored materials (before profile baking), so the checks talk
 * about what the asset author chose.
 */
export function checkMaterials({ info, profile, sourceMaterials }) {
  const out = [];
  const pm = profile.materials;
  for (const m of info.materials) {
    const sev = policy(pm.alphaModes?.[m.alphaMode]);
    if (sev) {
      out.push(issue('material.alpha-mode', sev, `material '${m.name}' uses alpha mode ${m.alphaMode} (${profile.label}: ${pm.alphaModes[m.alphaMode]})`, { where: m.name, hint: m.alphaMode === 'BLEND' ? 'Transparency sorting differs between engines; prefer opaque or mask.' : undefined }));
    }
    if (m.doubleSided) out.push(issue('material.double-sided', 'error', `material '${m.name}' is double-sided`, { where: m.name }));
  }
  for (const m of sourceMaterials) {
    const textured = m.baseColorTexture !== null;
    if (!textured && m.metallic > 0.15 && m.metallic < 0.85 && m.metallicRoughnessTexture === null) {
      out.push(issue('material.metallic-midrange', 'warning', `material '${m.name}' has metalness ${m.metallic} (real materials are 0 or 1)`, { where: m.name, hint: 'Use 1 for bare metal, 0 for everything else (paint, rust, wood, stone).' }));
    }
    if (!textured) {
      const [r, g, b] = m.baseColor.map(toSRGB);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (m.metallic < 0.5 && (l < 0.035 || l > 0.95)) {
        out.push(issue('material.albedo-range', 'warning', `material '${m.name}' base color is ${l < 0.5 ? 'almost black' : 'almost white'} (sRGB luminance ${l.toFixed(2)})`, { where: m.name, hint: 'Non-metal albedo should stay roughly within 30–240 sRGB so engine lighting reads correctly.' }));
      }
    }
    if (m.metallic >= 0.8 && m.roughness <= 0.3 && m.metallicRoughnessTexture === null) {
      out.push(issue('material.needs-reflections', 'warning', `material '${m.name}' is polished metal (roughness ${m.roughness}); without an environment map it renders dark`, { where: m.name, hint: 'Engines with a sky/environment will look brighter than the neutral viewport. Raise roughness (0.35–0.6) for predictable results.' }));
    }
    const emissive = m.emissive.some((v) => v > 0.001) || m.emissiveTexture !== null;
    if (emissive) {
      const sev = policy(pm.emissive);
      if (sev) out.push(issue('material.emissive', sev, `material '${m.name}' is emissive; emissive import on ${profile.label} is not verified`, { where: m.name, hint: 'Check glow in the engine (engines/*/CHECKLIST.md). Keep the base color meaningful without the glow.' }));
      if (m.emissiveStrength > 1 && !pm.emissiveStrength) {
        out.push(issue('material.emissive-strength', 'warning', `material '${m.name}' uses emissive strength ${m.emissiveStrength}; ${profile.label} has no emissive strength, clamped to 1`, { where: m.name }));
      }
    }
  }
  return out;
}
