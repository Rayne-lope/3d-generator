// Scene-level checks: origin, dimensions, triangle limits, mesh counts.

import { issue } from '../issues.js';
import { footprintBand } from '../../../kit/runtime.js';

const PLAUSIBLE = {
  prop: [0.02, 6], furniture: [0.15, 5], container: [0.05, 8], architecture: [0.3, 80], environment: [0.3, 250],
  nature: [0.03, 40], vehicle: [0.3, 30], weapon: [0.05, 5], lighting: [0.05, 10], decor: [0.02, 5], modular: [0.2, 40],
};

export function checkScene({ info, profile, meta }) {
  const out = [];
  const perMeter = profile.units.perMeter;
  const sizeM = info.bbox.size.map((v) => v / perMeter);
  const minM = info.bbox.min.map((v) => v / perMeter);
  const maxM = info.bbox.max.map((v) => v / perMeter);
  if (info.triangles === 0) {
    out.push(issue('scene.empty', 'error', 'the GLB has no triangles', { hint: 'build() must add meshes to the asset root.' }));
    return out;
  }
  const largest = Math.max(...sizeM);
  const tol = Math.max(0.002, largest * 0.01);
  const origin = meta.origin || 'base-center';
  if (origin === 'base-center') {
    // Same rule as the kit's applyOrigin: x/z at the center of the footprint.
    const limit = info.bbox.min[1] + footprintBand(info.bbox.size[1] / perMeter) * perMeter;
    const foot = [Infinity, -Infinity, Infinity, -Infinity];
    for (const m of info.meshes) {
      for (const prim of m.primitives) {
        const p = prim.positions;
        for (let i = 0; i < p.length; i += 3) {
          if (p[i + 1] > limit) continue;
          if (p[i] < foot[0]) foot[0] = p[i];
          if (p[i] > foot[1]) foot[1] = p[i];
          if (p[i + 2] < foot[2]) foot[2] = p[i + 2];
          if (p[i + 2] > foot[3]) foot[3] = p[i + 2];
        }
      }
    }
    const cx = (foot[0] + foot[1]) / 2 / perMeter;
    const cz = (foot[2] + foot[3]) / 2 / perMeter;
    if (Math.abs(minM[1]) > 0.002 || Math.abs(cx) > tol || Math.abs(cz) > tol) {
      out.push(issue('scene.origin', 'warning', `origin is not at the base center (min y ${minM[1].toFixed(3)} m, footprint center x ${cx.toFixed(3)} m, z ${cz.toFixed(3)} m)`, { hint: "Keep meta.origin 'base-center' (default) or set it to what the asset needs." }));
    }
  }
  const range = PLAUSIBLE[meta.category] || PLAUSIBLE.prop;
  if (largest < range[0] || largest > range[1]) {
    out.push(issue('scene.dimensions', 'warning', `largest dimension ${largest.toFixed(2)} m is unusual for a '${meta.category || 'prop'}' (${range[0]}–${range[1]} m)`, { hint: 'Assets are authored in meters (1 unit = 1 m). Check the scale against rules/02-proportion-and-scale.md.' }));
  }
  const g = profile.geometry;
  for (const m of info.meshes) {
    if (g.maxTrianglesPerMesh && m.triangles > g.maxTrianglesPerMesh) {
      out.push(issue('scene.mesh-triangles', 'error', `mesh '${m.node}' has ${m.triangles.toLocaleString('en-US')} triangles (limit ${g.maxTrianglesPerMesh.toLocaleString('en-US')} per mesh for ${profile.label})`, { where: m.node, hint: 'Lower segment counts, remove hidden faces, or split the part. The Roblox importer rejects meshes over 20k triangles.' }));
    } else if (g.warnTrianglesPerMesh && m.triangles > g.warnTrianglesPerMesh) {
      out.push(issue('scene.mesh-triangles', 'warning', `mesh '${m.node}' has ${m.triangles.toLocaleString('en-US')} triangles (recommended ≤ ${g.warnTrianglesPerMesh.toLocaleString('en-US')} for ${profile.label})`, { where: m.node }));
    }
  }
  if (g.warnTrianglesTotal && info.triangles > g.warnTrianglesTotal) {
    out.push(issue('scene.triangles-total', 'warning', `${info.triangles.toLocaleString('en-US')} triangles in total (recommended ≤ ${g.warnTrianglesTotal.toLocaleString('en-US')} for ${profile.label})`));
  }
  const budget = meta.budget?.triangles;
  if (budget && info.triangles > budget) {
    out.push(issue('scene.triangle-budget', 'warning', `${info.triangles.toLocaleString('en-US')} triangles exceeds the asset budget of ${budget.toLocaleString('en-US')}`, { hint: 'Reduce segments on small or hidden features first (rules/05-topology-and-efficiency.md).' }));
  }
  if (g.warnMeshes && info.meshes.length > g.warnMeshes) {
    out.push(issue('scene.mesh-count', 'warning', `${info.meshes.length} meshes (each becomes a draw call / MeshPart; recommended ≤ ${g.warnMeshes})`, { hint: 'Merge non-moving parts and share materials.' }));
  }
  const maxMat = profile.materials.maxMaterialsPerMesh;
  if (maxMat) {
    for (const m of info.meshes) {
      const mats = new Set(m.primitives.map((p) => p.material));
      if (mats.size > maxMat) out.push(issue('scene.materials-per-mesh', 'error', `mesh '${m.node}' uses ${mats.size} materials (${profile.label} allows ${maxMat})`, { where: m.node }));
    }
  }
  for (const n of info.nodes) {
    if (n.scale.some((s) => Math.abs(s - 1) > 1e-6)) out.push(issue('scene.node-scale', 'warning', `node '${n.name}' has scale ${n.scale.join(', ')}`, { where: n.name }));
  }
  for (const f of floatingPieces(info, perMeter)) {
    out.push(issue('scene.floating-part', 'info', `a piece of '${f.node}' (${f.triangles} triangles, around ${f.center.map((v) => v.toFixed(3)).join(', ')} m) touches nothing else: is it floating?`, { where: f.node, hint: 'Move it until it overlaps what it is attached to by 1–2 mm (open parts.png from the review to see which part it is), or ignore this if it floats on purpose (sparks, glow).' }));
  }
  return out;
}

/**
 * Connected pieces whose padded bounding box touches no other piece and that do not stand on
 * the ground. Bounding boxes keep it fast and conservative: only clearly detached pieces show.
 */
export function floatingPieces(info, perMeter = 1, { maxPieces = 2000, maxVertices = 400000 } = {}) {
  let total = 0;
  for (const m of info.meshes) for (const p of m.primitives) total += p.positions.length / 3;
  if (total > maxVertices) return [];
  const pieces = [];
  for (const m of info.meshes) {
    for (const prim of m.primitives) {
      const P = prim.positions;
      const I = prim.indices;
      const keyId = new Map();
      const parent = [];
      const find = (x) => {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]];
          x = parent[x];
        }
        return x;
      };
      const vid = new Int32Array(P.length / 3);
      for (let v = 0; v < P.length / 3; v++) {
        const k = `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)}`;
        let id = keyId.get(k);
        if (id === undefined) {
          id = parent.length;
          parent.push(id);
          keyId.set(k, id);
        }
        vid[v] = id;
      }
      for (let t = 0; t < I.length; t += 3) {
        const a = find(vid[I[t]]);
        parent[find(vid[I[t + 1]])] = a;
        parent[find(vid[I[t + 2]])] = a;
      }
      const boxes = new Map();
      for (let t = 0; t < I.length; t += 3) {
        const r = find(vid[I[t]]);
        let b = boxes.get(r);
        if (!b) boxes.set(r, (b = { node: m.node, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], triangles: 0 }));
        b.triangles++;
        for (let k = 0; k < 3; k++) {
          const v = I[t + k];
          for (let c = 0; c < 3; c++) {
            const x = P[v * 3 + c];
            if (x < b.min[c]) b.min[c] = x;
            if (x > b.max[c]) b.max[c] = x;
          }
        }
      }
      pieces.push(...boxes.values());
      if (pieces.length > maxPieces) return [];
    }
  }
  if (pieces.length < 2) return [];
  const size = Math.max(...info.bbox.size);
  const pad = Math.max(0.001 * perMeter, size * 0.003);
  const parent = pieces.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const touch = (a, b) => a.min.every((v, c) => v - pad <= b.max[c] && b.min[c] - pad <= a.max[c]);
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) if (touch(pieces[i], pieces[j])) parent[find(j)] = find(i);
  }
  const groups = new Map();
  pieces.forEach((p, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p);
  });
  if (groups.size < 2) return [];
  const list = [...groups.values()].map((g) => ({
    pieces: g,
    triangles: g.reduce((s, p) => s + p.triangles, 0),
    minY: Math.min(...g.map((p) => p.min[1])),
  })).sort((a, b) => b.triangles - a.triangles);
  const ground = info.bbox.min[1] + pad;
  return list.slice(1).filter((g) => g.minY > ground).slice(0, 5).map((g) => {
    const big = g.pieces.reduce((a, b) => (b.triangles > a.triangles ? b : a));
    const min = [0, 1, 2].map((c) => Math.min(...g.pieces.map((p) => p.min[c])));
    const max = [0, 1, 2].map((c) => Math.max(...g.pieces.map((p) => p.max[c])));
    return { node: big.node, triangles: g.triangles, center: min.map((v, c) => (v + max[c]) / 2 / perMeter) };
  });
}
