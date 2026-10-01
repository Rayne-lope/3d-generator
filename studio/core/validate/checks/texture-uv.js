// Texture and UV checks — the ones that decide whether an export stays crisp in the
// engine: texture size limits, texel density (texels per meter), UV range, UV stretching,
// and padding between UV islands on atlas textures (bleeding at mips / downscaling).

import { issue, policy } from '../issues.js';
import { uvIslands, rasterizeIslands, measurePadding } from '../../uvtools.js';

const isPOT = (n) => n > 0 && (n & (n - 1)) === 0;

function gather(info, texIndex) {
  const uvs = [];
  const world = [];
  const refs = [];
  for (const mesh of info.meshes) {
    for (const prim of mesh.primitives) {
      const mat = info.materials[prim.material];
      if (!mat || !prim.uvs) continue;
      const slots = Object.entries(mat.maps).filter(([, ref]) => ref && ref.texture === texIndex);
      if (!slots.length) continue;
      refs.push(...slots.map(([slot, ref]) => ({ slot, material: mat.name, wrapS: ref.wrapS, wrapT: ref.wrapT })));
      const P = prim.positions;
      const U = prim.uvs;
      const I = prim.indices;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t]; const b = I[t + 1]; const c = I[t + 2];
        uvs.push(U[a * 2], U[a * 2 + 1], U[b * 2], U[b * 2 + 1], U[c * 2], U[c * 2 + 1]);
        const ux = P[b * 3] - P[a * 3]; const uy = P[b * 3 + 1] - P[a * 3 + 1]; const uz = P[b * 3 + 2] - P[a * 3 + 2];
        const wx = P[c * 3] - P[a * 3]; const wy = P[c * 3 + 1] - P[a * 3 + 1]; const wz = P[c * 3 + 2] - P[a * 3 + 2];
        world.push(Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2);
      }
    }
  }
  return { uvs: Float32Array.from(uvs), world: Float64Array.from(world), refs };
}

function uvArea(uvs, t) {
  const ax = uvs[t * 6]; const ay = uvs[t * 6 + 1];
  return Math.abs((uvs[t * 6 + 2] - ax) * (uvs[t * 6 + 5] - ay) - (uvs[t * 6 + 4] - ax) * (uvs[t * 6 + 3] - ay)) / 2;
}

/**
 * @returns {{issues: any[], textures: any[]}} issues plus per-texture analysis for the report/viewport
 */
export function checkTexturesAndUVs({ info, profile }) {
  const out = [];
  const analysis = [];
  const perMeter = profile.units.perMeter;
  const tp = profile.textures;

  for (const mesh of info.meshes) {
    for (const prim of mesh.primitives) {
      const mat = info.materials[prim.material];
      if (!mat) continue;
      const textured = Object.values(mat.maps).some(Boolean);
      if (textured && !prim.uvs) out.push(issue('uv.missing', 'error', `mesh '${mesh.node}' uses textured material '${mat.name}' but has no UVs`, { where: mesh.node }));
      if (prim.uvs && profile.uv.require01) {
        let outside = 0;
        for (let i = 0; i < prim.uvs.length; i++) if (prim.uvs[i] < -1e-4 || prim.uvs[i] > 1 + 1e-4) outside++;
        if (outside) out.push(issue('uv.out-of-range', 'error', `mesh '${mesh.node}' has UVs outside 0..1 (${profile.label} requires 0..1)`, { where: mesh.node, hint: 'The Roblox profile bakes tiling automatically; this means a texture could not be tile-baked (see notes).' }));
      }
    }
  }

  let totalPixels = 0;
  const densities = [];
  info.textures.forEach((tex, ti) => {
    totalPixels += tex.width * tex.height;
    if (tp.maxSize && Math.max(tex.width, tex.height) > tp.maxSize) {
      out.push(issue('texture.too-large', 'error', `texture '${tex.name}' is ${tex.width}×${tex.height} (max ${tp.maxSize} for ${profile.label})`, { where: tex.name, hint: `The engine would downscale it and the result would differ from the preview. Author at ≤ ${tp.maxSize}px.` }));
    } else if (tp.warnSize && Math.max(tex.width, tex.height) > tp.warnSize) {
      out.push(issue('texture.large', 'warning', `texture '${tex.name}' is ${tex.width}×${tex.height} (recommended ≤ ${tp.warnSize})`, { where: tex.name }));
    }
    const potSeverity = policy(tp.powerOfTwo);
    if (potSeverity && (!isPOT(tex.width) || !isPOT(tex.height))) {
      out.push(issue('texture.non-power-of-two', potSeverity, `texture '${tex.name}' is ${tex.width}×${tex.height} (not a power of two)`, { where: tex.name, hint: 'Use 256, 512, 1024… so mipmaps and engine compression stay clean.' }));
    }

    const { uvs, world, refs } = gather(info, ti);
    const triCount = uvs.length / 6;
    if (!triCount) return;
    const isPalette = tex.name.startsWith('palette');
    const atlas = isPalette || refs.every((r) => r.wrapS === 'CLAMP_TO_EDGE' && r.wrapT === 'CLAMP_TO_EDGE');
    const entry = { texture: ti, name: tex.name, width: tex.width, height: tex.height, slots: [...new Set(refs.map((r) => r.slot))], materials: [...new Set(refs.map((r) => r.material))], layout: isPalette ? 'palette' : atlas ? 'atlas' : 'tiling' };

    // Texel density (texels per meter), area weighted.
    if (!isPalette) {
      let uvPx = 0;
      let areaM = 0;
      const per = [];
      for (let t = 0; t < triCount; t++) {
        const wm = world[t] / (perMeter * perMeter);
        if (wm <= 1e-12) continue;
        const up = uvArea(uvs, t) * tex.width * tex.height;
        uvPx += up;
        areaM += wm;
        per.push({ d: Math.sqrt(up / wm), w: wm });
      }
      if (areaM > 0) {
        const density = Math.sqrt(uvPx / areaM);
        entry.texelDensity = Math.round(density);
        densities.push({ name: tex.name, density });
        const dens = tp.texelDensity || {};
        if (dens.min && density < dens.min) {
          out.push(issue('texture.low-density', profile.id === 'roblox' ? 'error' : 'warning', `texture '${tex.name}' gives ${Math.round(density)} px/m on the model (minimum ${dens.min} px/m for ${profile.label}) — it will look blurry`, { where: tex.name, hint: 'Shrink the area one texture covers (tile it, split the material, or use a smaller atlas region) or raise the resolution within the profile limit.' }));
        } else if (dens.target && density < dens.target) {
          out.push(issue('texture.density-below-target', 'info', `texture '${tex.name}' gives ${Math.round(density)} px/m (target ${dens.target} px/m)`, { where: tex.name }));
        }
        // Stretch: triangles far from the median density.
        per.sort((a, b) => a.d - b.d);
        const totalW = per.reduce((s, p) => s + p.w, 0);
        let acc = 0;
        let median = per[0]?.d || 0;
        for (const p of per) {
          acc += p.w;
          if (acc >= totalW / 2) {
            median = p.d;
            break;
          }
        }
        const stretchedArea = per.filter((p) => p.d > median * 4 || p.d < median / 4).reduce((s, p) => s + p.w, 0);
        entry.stretchedFraction = totalW > 0 ? Math.round((stretchedArea / totalW) * 1000) / 1000 : 0;
        if (entry.stretchedFraction > 0.05) {
          out.push(issue('uv.stretch', 'warning', `${Math.round(entry.stretchedFraction * 100)}% of the surface using '${tex.name}' has strongly stretched or squashed UVs`, { where: tex.name, hint: 'Use k.uv.box()/cylindrical() world-scale projections or k.uv.unwrap() for even texel density.' }));
        }
      }
      let degenerateUV = 0;
      for (let t = 0; t < triCount; t++) if (world[t] > 1e-9 && uvArea(uvs, t) < 1e-12) degenerateUV++;
      if (degenerateUV > triCount * 0.01) out.push(issue('uv.degenerate', 'warning', `${degenerateUV} triangles using '${tex.name}' have zero UV area (texture smears across them)`, { where: tex.name }));
    }

    // Padding between islands for atlas-style textures (tiling textures repeat on purpose).
    if (atlas) {
      const { ids, count } = uvIslands(uvs);
      entry.islands = count;
      if (count > 1) {
        const { labels, overlap } = rasterizeIslands(uvs, ids, tex.width, tex.height);
        const pad = measurePadding(labels, tex.width, tex.height);
        entry.minPaddingPx = pad.minGap === null ? null : Math.round(pad.minGap * 10) / 10;
        entry.requiredPaddingPx = tp.uvPaddingPx;
        entry.paddingViolations = pad.locations.filter((l) => l.gap < tp.uvPaddingPx).map((l) => ({ x: l.x, y: l.y, gap: l.gap }));
        if (pad.minGap !== null && pad.minGap < tp.uvPaddingPx) {
          out.push(issue('uv.padding', profile.id === 'roblox' ? 'error' : 'warning', `UV islands in '${tex.name}' are only ${entry.minPaddingPx}px apart at ${tex.width}×${tex.height} (needs ≥ ${tp.uvPaddingPx}px for ${profile.label}); colors will bleed at a distance`, { where: tex.name, data: { locations: entry.paddingViolations.slice(0, 10) }, hint: `Repack with k.uv.atlas(entries, { padding: ${Math.max(tp.uvPaddingPx, 8)} }) or give the texture more resolution.` }));
        }
        const overlapRatio = overlap / Math.max(1, tex.width * tex.height);
        entry.overlapPixels = overlap;
        if (!isPalette && overlap > 0 && overlapRatio > 0.0005) {
          out.push(issue('uv.overlap', 'warning', `UV islands overlap in atlas texture '${tex.name}' (${overlap} texels)`, { where: tex.name, hint: 'Overlapping islands show the same pixels twice; use k.uv.unwrap + k.uv.atlas for unique UVs.' }));
        }
      }
    }
    analysis.push(entry);
  });

  if (tp.warnTotalMegapixels && totalPixels / 1e6 > tp.warnTotalMegapixels) {
    out.push(issue('texture.memory', 'warning', `${(totalPixels / 1e6).toFixed(1)} MP of textures (recommended ≤ ${tp.warnTotalMegapixels} MP for ${profile.label})`));
  }
  if (densities.length > 1) {
    const max = Math.max(...densities.map((d) => d.density));
    const min = Math.min(...densities.map((d) => d.density));
    if (min > 0 && max / min > 3) {
      out.push(issue('texture.density-mismatch', 'warning', `texel density varies ${Math.round(max / min)}× between textures (${Math.round(min)}–${Math.round(max)} px/m); parts will look unevenly sharp`, { hint: 'Keep density consistent across one asset (rules/04-materials-and-textures.md).' }));
    }
  }
  return { issues: out, textures: analysis };
}
