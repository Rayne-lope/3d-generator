// Geometry checks on the written GLB (world space): NaN, degenerate and duplicate
// triangles, broken normals, faces whose winding disagrees with their normals, and
// closed shells that are inside-out (negative volume). Engines cull back faces, so
// inverted faces show up as holes.

import { issue } from '../issues.js';

function q(v) {
  return Math.round(v * 1e5);
}

export function checkGeometry({ info, profile }) {
  const out = [];
  const perMeter = profile.units.perMeter;
  const areaEps = 1e-10 * perMeter * perMeter;
  for (const mesh of info.meshes) {
    let nan = 0;
    let degenerate = 0;
    let badNormals = 0;
    let inverted = 0;
    let totalTris = 0;
    let duplicate = 0;
    const seenTris = new Set();
    // Mesh-wide welded topology for shell analysis.
    const vertexKey = new Map();
    const shellTris = [];
    for (const prim of mesh.primitives) {
      const P = prim.positions;
      const N = prim.normals;
      const I = prim.indices;
      for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) nan++;
      if (N) {
        for (let v = 0; v < N.length; v += 3) {
          const len = Math.hypot(N[v], N[v + 1], N[v + 2]);
          if (!Number.isFinite(len) || Math.abs(len - 1) > 0.02) badNormals++;
        }
      }
      const key = (vi) => {
        const k = `${q(P[vi * 3])},${q(P[vi * 3 + 1])},${q(P[vi * 3 + 2])}`;
        let id = vertexKey.get(k);
        if (id === undefined) {
          id = vertexKey.size;
          vertexKey.set(k, id);
        }
        return id;
      };
      for (let t = 0; t < I.length; t += 3) {
        totalTris++;
        const a = I[t];
        const b = I[t + 1];
        const c = I[t + 2];
        const ax = P[a * 3]; const ay = P[a * 3 + 1]; const az = P[a * 3 + 2];
        const ux = P[b * 3] - ax; const uy = P[b * 3 + 1] - ay; const uz = P[b * 3 + 2] - az;
        const wx = P[c * 3] - ax; const wy = P[c * 3 + 1] - ay; const wz = P[c * 3 + 2] - az;
        const nx = uy * wz - uz * wy;
        const ny = uz * wx - ux * wz;
        const nz = ux * wy - uy * wx;
        const area2 = Math.hypot(nx, ny, nz);
        if (!(area2 / 2 > areaEps)) {
          degenerate++;
          continue;
        }
        if (N) {
          const vnx = N[a * 3] + N[b * 3] + N[c * 3];
          const vny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
          const vnz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
          if ((vnx * nx + vny * ny + vnz * nz) / area2 < -1e-3) inverted++;
        }
        const ka = key(a);
        const kb = key(b);
        const kc = key(c);
        const sorted = [ka, kb, kc].sort((x, y) => x - y).join(',');
        if (seenTris.has(sorted)) duplicate++;
        else seenTris.add(sorted);
        shellTris.push([ka, kb, kc, ax, ay, az, P[b * 3], P[b * 3 + 1], P[b * 3 + 2], P[c * 3], P[c * 3 + 1], P[c * 3 + 2]]);
      }
    }
    const where = mesh.node;
    if (nan) out.push(issue('geometry.nan', 'error', `mesh '${where}' has ${nan} NaN/Infinity coordinates`, { where, hint: 'A division by zero or invalid parameter in build(); check params.' }));
    if (degenerate) out.push(issue('geometry.degenerate', degenerate > totalTris * 0.02 ? 'warning' : 'info', `mesh '${where}' has ${degenerate} zero-area triangles`, { where, hint: 'Usually from collapsed lathe/extrude points or CSG slivers. Harmless when few.' }));
    if (badNormals) out.push(issue('geometry.bad-normals', 'warning', `mesh '${where}' has ${badNormals} invalid normals`, { where, hint: 'Recompute shading with k.op.crease()/flat().' }));
    if (inverted) {
      const severe = inverted > Math.max(2, totalTris * 0.005);
      out.push(issue('geometry.inverted-faces', severe ? 'error' : 'warning', `mesh '${where}' has ${inverted} triangles whose winding disagrees with their normals (they render as holes in engines)`, { where, hint: 'Avoid negative scale; use k.op.mirror(). Check custom vertex/face code for reversed order.' }));
    }
    if (duplicate) out.push(issue('geometry.duplicate-faces', 'warning', `mesh '${where}' has ${duplicate} duplicated triangles (z-fighting)`, { where, hint: 'Two meshes share a surface; offset or remove one.' }));

    // Shell analysis: closed components with negative signed volume are inside-out.
    const parent = new Int32Array(vertexKey.size).map((_, i) => i);
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    for (const t of shellTris) {
      parent[find(t[1])] = find(t[0]);
      parent[find(t[2])] = find(t[0]);
    }
    const shells = new Map();
    for (const t of shellTris) {
      const r = find(t[0]);
      if (!shells.has(r)) shells.set(r, { tris: [], edges: new Map() });
      const s = shells.get(r);
      s.tris.push(t);
      for (const [x, y] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
        const k = x < y ? `${x}_${y}` : `${y}_${x}`;
        s.edges.set(k, (s.edges.get(k) || 0) + 1);
      }
    }
    let insideOut = 0;
    let open = 0;
    let nonManifold = 0;
    for (const s of shells.values()) {
      let closed = true;
      for (const n of s.edges.values()) {
        if (n === 1) {
          closed = false;
          open++;
        } else if (n > 2) nonManifold++;
      }
      if (!closed) continue;
      let vol = 0;
      for (const t of s.tris) {
        vol += (t[3] * (t[7] * t[11] - t[8] * t[10]) - t[4] * (t[6] * t[11] - t[8] * t[9]) + t[5] * (t[6] * t[10] - t[7] * t[9])) / 6;
      }
      if (vol < 0) insideOut++;
    }
    if (insideOut) out.push(issue('geometry.inside-out', 'error', `mesh '${where}' has ${insideOut} closed shell(s) with inverted (inside-out) faces`, { where, hint: 'The whole shell faces inward; this happens with mirrored geometry or reversed custom triangles.' }));
    if (open) out.push(issue('geometry.open-edges', 'info', `mesh '${where}' has ${open} open edges`, { where, hint: 'Open shells are fine when their back is never visible; otherwise close them.' }));
    if (nonManifold) out.push(issue('geometry.non-manifold', 'info', `mesh '${where}' has ${nonManifold} edges shared by 3+ triangles`, { where }));
  }
  return out;
}
