// Engine-profile transforms on the IR. Each step records a note so the report explains
// exactly what changed between the authored scene and the engine file.
//
// Order: tile-bake → bake factors → palette atlas → split by material → triangle limit
// → texture limits → gutter dilation → emissive clamp → unit scale.

import { MeshoptSimplifier } from 'meshoptimizer';
import { linearToSrgb, srgbToLinear, nextPOT, resizeImage, solidImage, tileResize, to8 } from './pixels.js';
import { uvIslands, rasterizeIslands, dilate } from '../uvtools.js';

const SWATCH = 16;
const isPOT = (n) => n > 0 && (n & (n - 1)) === 0;
const floorPOT = (n) => 2 ** Math.floor(Math.log2(Math.max(1, n)));
const TEX_KEYS = ['baseColorTexture', 'metallicRoughnessTexture', 'normalTexture', 'occlusionTexture', 'emissiveTexture'];

const isTextured = (m) => TEX_KEYS.some((k) => m[k] !== null);

function cloneTexture(ir, texId, patch) {
  const src = ir.textures[texId];
  const t = { ...src, id: ir.textures.length, data: new Uint8Array(src.data), slots: [...src.slots], ...patch };
  ir.textures.push(t);
  return t;
}

function newTexture(ir, props) {
  const t = { id: ir.textures.length, tileable: false, layout: 'atlas', wrapS: 'CLAMP_TO_EDGE', wrapT: 'CLAMP_TO_EDGE', filter: 'linear', hasAO: false, slots: [], ...props };
  ir.textures.push(t);
  return t;
}

function primsUsing(ir, matId) {
  const list = [];
  for (const n of ir.nodes) for (const p of n.primitives) if (p.material === matId) list.push(p);
  return list;
}

// ------------------------------------------------------------------ tile-bake

function tileBake(ir, profile) {
  const maxTiles = profile.uv.maxTiles || 16;
  for (const m of ir.materials) {
    if (!isTextured(m)) continue;
    const prims = primsUsing(ir, m.id);
    let uMin = Infinity; let uMax = -Infinity; let vMin = Infinity; let vMax = -Infinity;
    for (const p of prims) {
      for (let i = 0; i < p.uvs.length; i += 2) {
        uMin = Math.min(uMin, p.uvs[i]); uMax = Math.max(uMax, p.uvs[i]);
        vMin = Math.min(vMin, p.uvs[i + 1]); vMax = Math.max(vMax, p.uvs[i + 1]);
      }
    }
    const eps = 1e-4;
    if (uMin >= -eps && uMax <= 1 + eps && vMin >= -eps && vMax <= 1 + eps) continue;
    const texIds = TEX_KEYS.map((k) => m[k]).filter((t) => t !== null);
    const allTiling = texIds.every((t) => ir.textures[t].wrapS === 'REPEAT' && ir.textures[t].wrapT === 'REPEAT');
    if (!allTiling) {
      ir.notes.push({ id: 'tile-bake.skipped', message: `material '${m.name}' has UVs outside 0..1 on a non-repeating texture; cannot tile-bake` });
      continue;
    }
    const u0 = Math.floor(uMin + eps);
    const v0 = Math.floor(vMin + eps);
    const nu = Math.max(1, Math.ceil(uMax - eps) - u0);
    const nv = Math.max(1, Math.ceil(vMax - eps) - v0);
    if (nu * nv > maxTiles) {
      ir.notes.push({ id: 'tile-bake.too-many', message: `material '${m.name}' repeats ${nu}×${nv} times; more than ${maxTiles} tiles cannot be baked without losing detail. Use fewer repeats (larger texture scale) or split the surface.` });
      continue;
    }
    // Bake straight to the final size (profile max, power of two) — no giant intermediate image.
    const max = profile.textures.maxSize || 4096;
    for (const key of TEX_KEYS) {
      if (m[key] === null) continue;
      const src = ir.textures[m[key]];
      let w = src.width * nu;
      let h = src.height * nv;
      const scale = Math.min(1, max / Math.max(w, h));
      w = floorPOT(Math.max(1, Math.round(w * scale)));
      h = floorPOT(Math.max(1, Math.round(h * scale)));
      const data = tileResize(src.data, src.width, src.height, nu, nv, w, h, { space: src.space, normal: src.slots.includes('normal') });
      const t = cloneTexture(ir, m[key], { data, width: w, height: h, name: `${src.name}_x${nu}x${nv}`, tileable: true });
      m[key] = t.id;
      if (w !== src.width * nu || h !== src.height * nv) {
        ir.notes.push({ id: 'texture.downscaled', message: `texture '${t.name}' baked at ${w}×${h} instead of ${src.width * nu}×${src.height * nv} (${profile.label}: max ${max}px, power of two); the preview shows exactly this` });
      }
    }
    for (const p of prims) {
      for (let i = 0; i < p.uvs.length; i += 2) {
        p.uvs[i] = (p.uvs[i] - u0) / nu;
        p.uvs[i + 1] = (p.uvs[i + 1] - v0) / nv;
      }
    }
    ir.notes.push({ id: 'tile-bake', message: `material '${m.name}': ${nu}×${nv} texture repeats baked into the image so UVs fit 0..1` });
  }
}

// ------------------------------------------------------------------ factor baking

function bakeFactors(ir) {
  for (const m of ir.materials) {
    if (!isTextured(m)) continue;
    const changed = [];
    const [fr, fg, fb, fa] = m.baseColor;
    if (m.baseColorTexture !== null && (fr !== 1 || fg !== 1 || fb !== 1 || fa !== 1)) {
      const src = ir.textures[m.baseColorTexture];
      const t = cloneTexture(ir, m.baseColorTexture, { name: `${src.name}_tinted` });
      const d = t.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = to8(linearToSrgb(srgbToLinear(d[i] / 255) * fr));
        d[i + 1] = to8(linearToSrgb(srgbToLinear(d[i + 1] / 255) * fg));
        d[i + 2] = to8(linearToSrgb(srgbToLinear(d[i + 2] / 255) * fb));
        d[i + 3] = to8((d[i + 3] / 255) * fa);
      }
      m.baseColorTexture = t.id;
      changed.push('base color');
    } else if (m.baseColorTexture === null) {
      const c = [to8(linearToSrgb(fr)), to8(linearToSrgb(fg)), to8(linearToSrgb(fb)), to8(fa)];
      m.baseColorTexture = newTexture(ir, { name: `${m.name}_color`, width: 4, height: 4, data: solidImage(4, 4, c), space: 'srgb', slots: ['baseColor'] }).id;
      changed.push('base color (solid)');
    }
    m.baseColor = [1, 1, 1, 1];
    if (m.metallicRoughnessTexture !== null) {
      if (m.metallic !== 1 || m.roughness !== 1) {
        const src = ir.textures[m.metallicRoughnessTexture];
        const t = cloneTexture(ir, m.metallicRoughnessTexture, { name: `${src.name}_mr` });
        for (let i = 0; i < t.data.length; i += 4) {
          t.data[i + 1] = to8((t.data[i + 1] / 255) * m.roughness);
          t.data[i + 2] = to8((t.data[i + 2] / 255) * m.metallic);
        }
        m.metallicRoughnessTexture = t.id;
        changed.push('metal/rough');
      }
    } else {
      m.metallicRoughnessTexture = newTexture(ir, { name: `${m.name}_mr`, width: 4, height: 4, data: solidImage(4, 4, [255, to8(m.roughness), to8(m.metallic), 255]), space: 'linear', slots: ['metallicRoughness'] }).id;
      changed.push('metal/rough (solid)');
    }
    m.metallic = 1;
    m.roughness = 1;
    if (m.normalTexture !== null && m.normalScale !== 1) {
      const src = ir.textures[m.normalTexture];
      const t = cloneTexture(ir, m.normalTexture, { name: `${src.name}_s` });
      for (let i = 0; i < t.data.length; i += 4) {
        let nx = (t.data[i] / 255) * 2 - 1;
        let ny = (t.data[i + 1] / 255) * 2 - 1;
        let nz = (t.data[i + 2] / 255) * 2 - 1;
        nx *= m.normalScale;
        ny *= m.normalScale;
        nz = Math.max(1e-3, nz);
        const len = Math.hypot(nx, ny, nz);
        t.data[i] = to8((nx / len) * 0.5 + 0.5);
        t.data[i + 1] = to8((ny / len) * 0.5 + 0.5);
        t.data[i + 2] = to8((nz / len) * 0.5 + 0.5);
      }
      m.normalTexture = t.id;
      m.normalScale = 1;
      changed.push('normal scale');
    }
    if (m.occlusionTexture !== null && m.occlusionStrength !== 1) {
      const src = ir.textures[m.occlusionTexture];
      const t = cloneTexture(ir, m.occlusionTexture, { name: `${src.name}_ao` });
      for (let i = 0; i < t.data.length; i += 4) t.data[i] = to8(1 + ((t.data[i] / 255) - 1) * m.occlusionStrength);
      m.occlusionTexture = t.id;
      m.occlusionStrength = 1;
      changed.push('occlusion strength');
    }
    const em = m.emissive.map((v) => v * m.emissiveStrength);
    if (em.some((v) => v > 0)) {
      if (m.emissiveTexture !== null) {
        const src = ir.textures[m.emissiveTexture];
        const t = cloneTexture(ir, m.emissiveTexture, { name: `${src.name}_e` });
        for (let i = 0; i < t.data.length; i += 4) {
          for (let k = 0; k < 3; k++) t.data[i + k] = to8(linearToSrgb(Math.min(1, srgbToLinear(t.data[i + k] / 255) * em[k])));
        }
        m.emissiveTexture = t.id;
      } else {
        m.emissiveTexture = newTexture(ir, { name: `${m.name}_emissive`, width: 4, height: 4, data: solidImage(4, 4, [to8(linearToSrgb(Math.min(1, em[0]))), to8(linearToSrgb(Math.min(1, em[1]))), to8(linearToSrgb(Math.min(1, em[2]))), 255]), space: 'srgb', slots: ['emissive'] }).id;
      }
      m.emissive = [1, 1, 1];
      m.emissiveStrength = 1;
      changed.push('emissive');
    }
    if (changed.length) ir.notes.push({ id: 'bake-factors', message: `material '${m.name}': ${changed.join(', ')} baked into textures (engine ignores factors)` });
  }
}

// ------------------------------------------------------------------ palette atlas

function paletteAtlas(ir) {
  const flat = ir.materials.filter((m) => !isTextured(m) && primsUsing(ir, m.id).length);
  if (!flat.length) return;
  const groups = new Map();
  for (const m of flat) {
    const key = `${m.alphaMode}:${m.alphaMode === 'MASK' ? m.alphaCutoff : ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const [key, mats] of groups) {
    const alphaMode = key.split(':')[0];
    const swatches = [];
    const swatchOf = new Map();
    for (const m of mats) {
      const em = m.emissive.map((v) => Math.min(1, v * m.emissiveStrength));
      const color = [to8(linearToSrgb(m.baseColor[0])), to8(linearToSrgb(m.baseColor[1])), to8(linearToSrgb(m.baseColor[2])), to8(m.baseColor[3])];
      const mr = [255, to8(m.roughness), to8(m.metallic), 255];
      const e = [to8(linearToSrgb(em[0])), to8(linearToSrgb(em[1])), to8(linearToSrgb(em[2])), 255];
      const sig = `${color}|${mr}|${e}`;
      let idx = swatches.findIndex((s) => s.sig === sig);
      if (idx < 0) {
        idx = swatches.length;
        swatches.push({ sig, color, mr, e, names: [] });
      }
      swatches[idx].names.push(m.name);
      swatchOf.set(m.id, idx);
    }
    const cols = Math.ceil(Math.sqrt(swatches.length));
    const rows = Math.ceil(swatches.length / cols);
    const size = nextPOT(Math.max(cols, rows) * SWATCH);
    const colorImg = solidImage(size, size, swatches[0].color);
    const mrImg = solidImage(size, size, swatches[0].mr);
    const hasEmissive = swatches.some((s) => s.e[0] + s.e[1] + s.e[2] > 0);
    const emImg = hasEmissive ? solidImage(size, size, [0, 0, 0, 255]) : null;
    swatches.forEach((s, i) => {
      const cx = (i % cols) * SWATCH;
      const cy = Math.floor(i / cols) * SWATCH;
      s.uv = [(cx + SWATCH / 2) / size, (cy + SWATCH / 2) / size];
      for (let y = cy; y < cy + SWATCH; y++) {
        for (let x = cx; x < cx + SWATCH; x++) {
          const o = (y * size + x) * 4;
          colorImg.set(s.color, o);
          mrImg.set(s.mr, o);
          if (emImg) emImg.set(s.e, o);
        }
      }
    });
    // Fill unused cells by extending the last row of swatches (keeps mips clean).
    const suffix = alphaMode === 'OPAQUE' ? '' : `_${alphaMode.toLowerCase()}`;
    const base = newTexture(ir, { name: `palette${suffix}`, width: size, height: size, data: colorImg, space: 'srgb', slots: ['baseColor'] });
    const mr = newTexture(ir, { name: `palette${suffix}_mr`, width: size, height: size, data: mrImg, space: 'linear', slots: ['metallicRoughness'] });
    const emt = emImg ? newTexture(ir, { name: `palette${suffix}_emissive`, width: size, height: size, data: emImg, space: 'srgb', slots: ['emissive'] }) : null;
    const pal = {
      id: ir.materials.length,
      name: `palette${suffix}`,
      baseColor: [1, 1, 1, 1],
      metallic: 1,
      roughness: 1,
      emissive: emt ? [1, 1, 1] : [0, 0, 0],
      emissiveStrength: 1,
      alphaMode,
      alphaCutoff: mats[0].alphaCutoff,
      doubleSided: false,
      baseColorTexture: base.id,
      metallicRoughnessTexture: mr.id,
      normalTexture: null,
      normalScale: 1,
      occlusionTexture: null,
      occlusionStrength: 1,
      emissiveTexture: emt ? emt.id : null,
      palette: swatches.map((s) => ({ uv: s.uv, color: s.color, roughness: s.mr[1] / 255, metallic: s.mr[2] / 255, materials: s.names })),
    };
    ir.materials.push(pal);
    for (const n of ir.nodes) {
      for (const p of n.primitives) {
        if (!swatchOf.has(p.material)) continue;
        const [u, v] = swatches[swatchOf.get(p.material)].uv;
        for (let i = 0; i < p.uvs.length; i += 2) {
          p.uvs[i] = u;
          p.uvs[i + 1] = v;
        }
        p.hasUV = true;
        p.material = pal.id;
      }
    }
    ir.notes.push({ id: 'palette', message: `${mats.length} flat-color material(s) merged into '${pal.name}' (${swatches.length} swatches, ${size}×${size}, ${SWATCH}px swatches)` });
  }
  mergeSameMaterial(ir);
}

function mergeSameMaterial(ir) {
  for (const n of ir.nodes) {
    const byMat = new Map();
    for (const p of n.primitives) {
      if (!byMat.has(p.material)) byMat.set(p.material, []);
      byMat.get(p.material).push(p);
    }
    n.primitives = [...byMat.entries()].map(([material, list]) => {
      if (list.length === 1) return list[0];
      const cat = (key) => {
        const total = list.reduce((s, p) => s + p[key].length, 0);
        const out = new Float32Array(total);
        let o = 0;
        for (const p of list) {
          out.set(p[key], o);
          o += p[key].length;
        }
        return out;
      };
      return { material, positions: cat('positions'), normals: cat('normals'), uvs: cat('uvs'), hasUV: list.some((p) => p.hasUV), missingNormals: list.some((p) => p.missingNormals) };
    });
  }
}

// ------------------------------------------------------------------ split by material

function splitByMaterial(ir) {
  const out = [];
  const remap = new Map();
  const add = (node) => {
    out.push(node);
    return out.length - 1;
  };
  const pending = [];
  ir.nodes.forEach((n, i) => {
    const copy = { ...n, primitives: n.primitives };
    if (n.primitives.length > 1) {
      copy.primitives = [];
      remap.set(i, add(copy));
      for (const p of n.primitives) pending.push({ parentOld: i, prim: p, name: `${n.name}_${ir.materials[p.material].name}` });
    } else {
      remap.set(i, add(copy));
    }
  });
  for (const n of out) if (n.parent !== null) n.parent = remap.get(n.parent);
  let splits = 0;
  for (const item of pending) {
    out.push({ name: uniqueName(out, item.name), parent: remap.get(item.parentOld), translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], primitives: [item.prim] });
    splits++;
  }
  ir.nodes = out;
  if (splits) ir.notes.push({ id: 'split-materials', message: `${splits} material primitive(s) moved to their own mesh (one material per mesh)` });
}

function uniqueName(nodes, base) {
  const clean = base.replace(/[^A-Za-z0-9_-]/g, '_');
  let name = clean;
  let i = 2;
  while (nodes.some((n) => n.name === name)) name = `${clean}_${i++}`;
  return name;
}

// ------------------------------------------------------------------ triangle limits

function components(prim) {
  const P = prim.positions;
  const triCount = P.length / 9;
  const key = (v) => `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)}`;
  const ids = new Map();
  const parent = [];
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const vid = (v) => {
    const k = key(v);
    if (!ids.has(k)) {
      ids.set(k, parent.length);
      parent.push(parent.length);
    }
    return ids.get(k);
  };
  const triV = [];
  for (let t = 0; t < triCount; t++) {
    const a = vid(t * 3);
    const b = vid(t * 3 + 1);
    const c = vid(t * 3 + 2);
    parent[find(b)] = find(a);
    parent[find(c)] = find(a);
    triV.push(a);
  }
  const groups = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(triV[t]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()];
}

function subPrim(prim, tris) {
  const pos = new Float32Array(tris.length * 9);
  const nrm = new Float32Array(tris.length * 9);
  const uv = new Float32Array(tris.length * 6);
  tris.forEach((t, i) => {
    pos.set(prim.positions.subarray(t * 9, t * 9 + 9), i * 9);
    nrm.set(prim.normals.subarray(t * 9, t * 9 + 9), i * 9);
    uv.set(prim.uvs.subarray(t * 6, t * 6 + 6), i * 6);
  });
  return { ...prim, positions: pos, normals: nrm, uvs: uv };
}

function decimate(prim, target) {
  // Weld identical vertices (position + normal + uv) so seams stay borders, then simplify.
  const count = prim.positions.length / 3;
  const map = new Map();
  const verts = [];
  const indices = new Uint32Array(count);
  for (let v = 0; v < count; v++) {
    const k = `${prim.positions[v * 3]},${prim.positions[v * 3 + 1]},${prim.positions[v * 3 + 2]},${prim.normals[v * 3]},${prim.normals[v * 3 + 1]},${prim.normals[v * 3 + 2]},${prim.uvs[v * 2]},${prim.uvs[v * 2 + 1]}`;
    let id = map.get(k);
    if (id === undefined) {
      id = verts.length;
      map.set(k, id);
      verts.push(v);
    }
    indices[v] = id;
  }
  const welded = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => welded.set(prim.positions.subarray(v * 3, v * 3 + 3), i * 3));
  const [result] = MeshoptSimplifier.simplify(indices, welded, 3, target * 3, 0.02, ['LockBorder']);
  const tris = result.length / 3;
  const out = { ...prim, positions: new Float32Array(tris * 9), normals: new Float32Array(tris * 9), uvs: new Float32Array(tris * 6) };
  for (let i = 0; i < result.length; i++) {
    const v = verts[result[i]];
    out.positions.set(prim.positions.subarray(v * 3, v * 3 + 3), i * 3);
    out.normals.set(prim.normals.subarray(v * 3, v * 3 + 3), i * 3);
    out.uvs.set(prim.uvs.subarray(v * 2, v * 2 + 2), i * 2);
  }
  return out;
}

function triangleLimit(ir, profile, { allowDecimate = false } = {}) {
  const limit = profile.geometry.maxTrianglesPerMesh;
  if (!limit || !profile.geometry.splitOverLimit) return;
  const added = [];
  ir.nodes.forEach((n, ni) => {
    const total = n.primitives.reduce((s, p) => s + p.positions.length / 9, 0);
    if (total <= limit) return;
    // One primitive per node at this point (Roblox splits by material first).
    const newPrims = [];
    for (const prim of n.primitives) {
      const tris = prim.positions.length / 9;
      if (tris <= limit) {
        newPrims.push([prim]);
        continue;
      }
      const comps = components(prim).sort((a, b) => b.length - a.length);
      const chunks = [];
      for (const comp of comps) {
        if (comp.length > limit) {
          if (allowDecimate) {
            const dec = decimate(subPrim(prim, comp), Math.floor(limit * 0.95));
            ir.notes.push({ id: 'decimate', message: `'${n.name}': a ${comp.length}-triangle piece was decimated to ${dec.positions.length / 9} triangles` });
            chunks.push({ prims: [dec], tris: dec.positions.length / 9, locked: true });
          } else {
            ir.notes.push({ id: 'tri-limit.unsplittable', message: `'${n.name}' contains one connected piece with ${comp.length} triangles (> ${limit}); reduce its segments or export with --allow-decimate` });
            chunks.push({ prims: [subPrim(prim, comp)], tris: comp.length, locked: true });
          }
          continue;
        }
        const chunk = chunks.find((c) => !c.locked && c.tris + comp.length <= limit);
        if (chunk) {
          chunk.tris += comp.length;
          chunk.tris_list.push(...comp);
        } else {
          chunks.push({ tris: comp.length, tris_list: [...comp] });
        }
      }
      for (const c of chunks) newPrims.push(c.prims || [subPrim(prim, c.tris_list)]);
    }
    if (newPrims.length <= 1) return;
    n.primitives = [];
    newPrims.forEach((prims, i) => added.push({ name: `${n.name}_chunk${i + 1}`, parent: ni, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], primitives: prims }));
    ir.notes.push({ id: 'tri-limit.split', message: `'${n.name}' (${total} triangles) split into ${newPrims.length} meshes of ≤ ${limit} triangles` });
  });
  for (const a of added) {
    a.name = uniqueName(ir.nodes, a.name);
    ir.nodes.push(a);
  }
}

// ------------------------------------------------------------------ textures

function textureLimits(ir, profile) {
  const max = profile.textures.maxSize;
  if (!max) return;
  // Engines that downscale or recompress textures (Roblox) get power-of-two sizes from us,
  // so the preview shows exactly the resolution the engine keeps.
  const forcePOT = !!profile.uv.tileBake;
  for (const t of ir.textures) {
    const tooBig = t.width > max || t.height > max;
    const npot = forcePOT && (!isPOT(t.width) || !isPOT(t.height));
    if (!tooBig && !npot) continue;
    const scale = Math.min(1, max / Math.max(t.width, t.height));
    let w = Math.max(1, Math.round(t.width * scale));
    let h = Math.max(1, Math.round(t.height * scale));
    if (forcePOT) {
      w = floorPOT(w);
      h = floorPOT(h);
    }
    const before = `${t.width}×${t.height}`;
    t.data = resizeImage(t.data, t.width, t.height, w, h, { space: t.space, normal: t.slots.includes('normal') });
    t.width = w;
    t.height = h;
    ir.notes.push({ id: 'texture.downscaled', message: `texture '${t.name}' resized ${before} → ${w}×${h} (${profile.label}: max ${max}px${forcePOT ? ', power of two' : ''}); the preview shows the resized result` });
  }
}

function dilateAtlases(ir) {
  ir.textures.forEach((t) => {
    if (t.name.startsWith('palette')) return;
    if (t.wrapS !== 'CLAMP_TO_EDGE' || t.wrapT !== 'CLAMP_TO_EDGE') return;
    const uvs = [];
    for (const m of ir.materials) {
      if (!TEX_KEYS.some((k) => m[k] === t.id)) continue;
      for (const p of primsUsing(ir, m.id)) uvs.push(...p.uvs);
    }
    if (!uvs.length) return;
    const flatUV = Float32Array.from(uvs);
    const { ids } = uvIslands(flatUV);
    const { labels, covered } = rasterizeIslands(flatUV, ids, t.width, t.height);
    if (covered === 0 || covered === t.width * t.height) return;
    t.data = dilate(t.data, labels, t.width, t.height, Math.max(8, Math.round(Math.max(t.width, t.height) / 32)));
    if (!ir.notes.some((n) => n.id === 'dilate')) ir.notes.push({ id: 'dilate', message: 'atlas texture gutters filled with edge colors (no bleeding at mips/downscale)' });
  });
}

function clampEmissive(ir, profile) {
  if (profile.materials.emissiveStrength) return;
  for (const m of ir.materials) {
    if (m.emissiveStrength > 1) {
      m.emissiveStrength = 1;
      ir.notes.push({ id: 'emissive.clamped', message: `material '${m.name}': emissive strength clamped to 1 (${profile.label})` });
    }
  }
}

function unitScale(ir, profile) {
  const s = profile.units.perMeter;
  if (s === 1) return;
  for (const n of ir.nodes) {
    n.translation = n.translation.map((v) => v * s);
    for (const p of n.primitives) for (let i = 0; i < p.positions.length; i++) p.positions[i] *= s;
  }
  ir.units = { name: profile.units.name, metersPerUnit: 1 / s, perMeter: s };
  ir.notes.push({ id: 'units', message: `scaled to ${profile.units.name}s (${s.toFixed(4)} per meter)` });
}

function dropUnusedMaterials(ir) {
  const used = new Set();
  for (const n of ir.nodes) for (const p of n.primitives) used.add(p.material);
  const keep = ir.materials.filter((m) => used.has(m.id));
  const idMap = new Map(keep.map((m, i) => [m.id, i]));
  ir.materials = keep.map((m, i) => ({ ...m, id: i }));
  for (const n of ir.nodes) for (const p of n.primitives) p.material = idMap.get(p.material);
  const usedTex = new Set();
  for (const m of ir.materials) for (const k of TEX_KEYS) if (m[k] !== null) usedTex.add(m[k]);
  const keepTex = ir.textures.filter((t) => usedTex.has(t.id));
  const tMap = new Map(keepTex.map((t, i) => [t.id, i]));
  ir.textures = keepTex.map((t, i) => ({ ...t, id: i }));
  for (const m of ir.materials) for (const k of TEX_KEYS) if (m[k] !== null) m[k] = tMap.get(m[k]);
}

/**
 * Apply an engine profile to an IR (mutates and returns it).
 * @param {any} ir
 * @param {any} profile
 * @param {{allowDecimate?: boolean}} [opts]
 */
export async function applyProfile(ir, profile, opts = {}) {
  ir.sourceMaterials = ir.materials.map((m) => ({ ...m }));
  ir.profile = profile.id;
  await MeshoptSimplifier.ready;
  if (profile.uv.tileBake) tileBake(ir, profile);
  textureLimits(ir, profile); // resize before per-pixel baking so big textures stay fast
  if (profile.materials.bakeFactorsIntoTextures) bakeFactors(ir);
  if (profile.materials.paletteAtlas) paletteAtlas(ir);
  if (profile.materials.maxMaterialsPerMesh === 1) splitByMaterial(ir);
  triangleLimit(ir, profile, opts);
  textureLimits(ir, profile);
  dropUnusedMaterials(ir);
  dilateAtlases(ir);
  clampEmissive(ir, profile);
  unitScale(ir, profile);
  return ir;
}
