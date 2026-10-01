// Scene-level checks: origin, dimensions, triangle limits, mesh counts.

import { issue } from '../issues.js';

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
  const cx = (minM[0] + maxM[0]) / 2;
  const cz = (minM[2] + maxM[2]) / 2;
  if (origin === 'base-center' && (Math.abs(minM[1]) > 0.002 || Math.abs(cx) > tol || Math.abs(cz) > tol)) {
    out.push(issue('scene.origin', 'warning', `origin is not at the base center (min y ${minM[1].toFixed(3)} m, center x ${cx.toFixed(3)} m, z ${cz.toFixed(3)} m)`, { hint: "Keep meta.origin 'base-center' (default) or set it to what the asset needs." }));
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
  return out;
}
