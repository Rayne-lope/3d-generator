// UV tools.
//
// Two ways to texture an asset:
//  1. Tiling (default): world-scale UVs (1 UV unit = 1 meter / scale) on a seamless
//     'tiling' texture. Texel density is automatically uniform across parts.
//  2. Atlas: unique, non-overlapping UVs packed into one texture with padding between
//     islands (k.uv.unwrap + k.uv.atlas), for painting details at specific places.
//     Padding protects against color bleeding at mip levels and engine downscaling.

import * as THREE from 'three';
import { nonIndexed } from './ops.js';

function faceAxis(nx, ny, nz) {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ax >= ay && ax >= az) return nx >= 0 ? '+x' : '-x';
  if (ay >= ax && ay >= az) return ny >= 0 ? '+y' : '-y';
  return nz >= 0 ? '+z' : '-z';
}

function project(axis, x, y, z) {
  switch (axis) {
    case '+x': return [-z, -y];
    case '-x': return [z, -y];
    case '+z': return [x, -y];
    case '-z': return [-x, -y];
    case '+y': return [x, z];
    default: return [x, -z];
  }
}

function faceNormal(pos, v) {
  const ax = pos[v * 3]; const ay = pos[v * 3 + 1]; const az = pos[v * 3 + 2];
  const bx = pos[v * 3 + 3]; const by = pos[v * 3 + 4]; const bz = pos[v * 3 + 5];
  const cx = pos[v * 3 + 6]; const cy = pos[v * 3 + 7]; const cz = pos[v * 3 + 8];
  const ux = bx - ax; const uy = by - ay; const uz = bz - az;
  const wx = cx - ax; const wy = cy - ay; const wz = cz - az;
  return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
}

function setUV(g, uvs) {
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/**
 * Box (triplanar) projection per triangle. scale = UV units per meter (texture repeats per meter).
 * Image top = geometric top on vertical faces; front (+Z) is at the image bottom on top faces.
 */
export function box(g, { scale = 1, offset = [0, 0] } = {}) {
  const out = nonIndexed(g);
  const pos = out.attributes.position.array;
  const count = out.attributes.position.count;
  const uvs = new Float32Array(count * 2);
  for (let v = 0; v + 2 < count; v += 3) {
    const [nx, ny, nz] = faceNormal(pos, v);
    const axis = faceAxis(nx, ny, nz);
    for (let k = 0; k < 3; k++) {
      const i = (v + k) * 3;
      const [u, w] = project(axis, pos[i], pos[i + 1], pos[i + 2]);
      uvs[(v + k) * 2] = u * scale + offset[0];
      uvs[(v + k) * 2 + 1] = w * scale + offset[1];
    }
  }
  return setUV(out, uvs);
}

/** Planar projection along an axis ('y' = top-down). */
export function planar(g, { axis = 'y', scale = 1, offset = [0, 0] } = {}) {
  const out = nonIndexed(g);
  const pos = out.attributes.position.array;
  const count = out.attributes.position.count;
  const uvs = new Float32Array(count * 2);
  const key = axis === 'x' ? '+x' : axis === 'z' ? '+z' : '+y';
  for (let i = 0; i < count; i++) {
    const [u, w] = project(key, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    uvs[i * 2] = u * scale + offset[0];
    uvs[i * 2 + 1] = w * scale + offset[1];
  }
  return setUV(out, uvs);
}

/**
 * Cylindrical projection around an axis. u = arc length at `radius` (meters × scale),
 * v = height (meters × scale, top at smaller v). Near-cap triangles get planar UVs.
 */
export function cylindrical(g, { axis = 'y', scale = 1, radius = null, capThreshold = 0.8 } = {}) {
  const out = nonIndexed(g);
  const pos = out.attributes.position.array;
  const count = out.attributes.position.count;
  const ai = axis === 'x' ? 0 : axis === 'z' ? 2 : 1;
  const [ia, ib] = [0, 1, 2].filter((k) => k !== ai);
  let r = radius;
  if (!r) {
    r = 0;
    for (let i = 0; i < count; i++) r = Math.max(r, Math.hypot(pos[i * 3 + ia], pos[i * 3 + ib]));
    r = r || 1;
  }
  const uvs = new Float32Array(count * 2);
  for (let v = 0; v + 2 < count; v += 3) {
    const n = faceNormal(pos, v);
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    if (Math.abs(n[ai] / len) > capThreshold) {
      for (let k = 0; k < 3; k++) {
        const i = (v + k) * 3;
        uvs[(v + k) * 2] = pos[i + ia] * scale;
        uvs[(v + k) * 2 + 1] = pos[i + ib] * scale;
      }
      continue;
    }
    const angles = [0, 1, 2].map((k) => Math.atan2(pos[(v + k) * 3 + ia], pos[(v + k) * 3 + ib]));
    // Unwrap triangles crossing the seam.
    const maxA = Math.max(...angles);
    for (let k = 0; k < 3; k++) if (maxA - angles[k] > Math.PI) angles[k] += Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      const i = (v + k) * 3;
      uvs[(v + k) * 2] = angles[k] * r * scale;
      uvs[(v + k) * 2 + 1] = -pos[i + ai] * scale;
    }
  }
  return setUV(out, uvs);
}

export function scaleUV(g, su, sv = su) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

export function offsetUV(g, du, dv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  uv.needsUpdate = true;
  return g;
}

export function rotateUV(g, angle) {
  const uv = g.attributes.uv;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, u * c - v * s, u * s + v * c);
  }
  uv.needsUpdate = true;
  return g;
}

/** Normalize UVs into [margin, 1 - margin] keeping aspect ratio (single-chart textures). */
export function fit(g, { margin = 0.0 } = {}) {
  const uv = g.attributes.uv;
  let minU = Infinity; let minV = Infinity; let maxU = -Infinity; let maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    minU = Math.min(minU, uv.getX(i)); maxU = Math.max(maxU, uv.getX(i));
    minV = Math.min(minV, uv.getY(i)); maxV = Math.max(maxV, uv.getY(i));
  }
  const span = Math.max(maxU - minU, maxV - minV) || 1;
  const s = (1 - 2 * margin) / span;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, margin + (uv.getX(i) - minU) * s, margin + (uv.getY(i) - minV) * s);
  uv.needsUpdate = true;
  return g;
}

/**
 * Box-projected unwrap with charts: triangles that share an edge and face the same
 * box axis form one chart. Charts never overlap once packed by k.uv.atlas().
 */
export function unwrap(g, { scale = 1 } = {}) {
  const out = box(g, { scale });
  const pos = out.attributes.position.array;
  const triCount = out.attributes.position.count / 3;
  const axes = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const [nx, ny, nz] = faceNormal(pos, t * 3);
    axes[t] = faceAxis(nx, ny, nz);
  }
  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const q = (i) => `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = q(t * 3 + e);
      const b = q(t * 3 + ((e + 1) % 3));
      const key = a < b ? `${a}|${b}|${axes[t]}` : `${b}|${a}|${axes[t]}`;
      const other = edges.get(key);
      if (other === undefined) edges.set(key, t);
      else parent[find(t)] = find(other);
    }
  }
  const groups = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    if (!groups.has(r)) groups.set(r, { axis: axes[t], tris: [] });
    groups.get(r).tris.push(t);
  }
  out.userData.charts = [...groups.values()].sort((a, b) => a.tris[0] - b.tris[0]);
  return out;
}

function chartBounds(g, tris) {
  const uv = g.attributes.uv.array;
  let minU = Infinity; let minV = Infinity; let maxU = -Infinity; let maxV = -Infinity;
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const i = (t * 3 + k) * 2;
      minU = Math.min(minU, uv[i]); maxU = Math.max(maxU, uv[i]);
      minV = Math.min(minV, uv[i + 1]); maxV = Math.max(maxV, uv[i + 1]);
    }
  }
  return { minU, minV, w: maxU - minU, h: maxV - minV };
}

function shelfPack(rects, size, padding) {
  const margin = Math.ceil(padding / 2);
  let x = margin;
  let y = margin;
  let shelf = 0;
  const placed = new Array(rects.length);
  for (const r of rects) {
    if (r.w + 2 * margin > size || r.h + 2 * margin > size) return null;
    if (x + r.w + margin > size) {
      y += shelf + padding;
      x = margin;
      shelf = 0;
    }
    if (y + r.h + margin > size) return null;
    placed[r.index] = { x, y, w: r.w, h: r.h };
    x += r.w + padding;
    shelf = Math.max(shelf, r.h);
  }
  return placed;
}

/**
 * Pack the charts of several geometries into one atlas with uniform texel density.
 * entries: { name: geometry } (geometries should come from k.uv.unwrap; others count as one chart).
 * UVs are rewritten in place. Returns a layout with pixel rects for painting.
 * @param {Record<string, THREE.BufferGeometry>} entries
 * @param {{size?: number, padding?: number, pxPerMeter?: number}} [opts]
 */
export function atlas(entries, { size = 1024, padding = 8, pxPerMeter = null } = {}) {
  const charts = [];
  for (const [name, g] of Object.entries(entries)) {
    if (!g?.attributes?.uv) throw new Error(`k.uv.atlas: entry '${name}' has no UVs (use k.uv.unwrap first)`);
    if (g.index) throw new Error(`k.uv.atlas: entry '${name}' must be non-indexed (kit geometries are)`);
    const list = g.userData.charts || [{ axis: 'any', tris: Array.from({ length: g.attributes.position.count / 3 }, (_, i) => i) }];
    list.forEach((c, i) => charts.push({ entry: name, index: i, axis: c.axis, tris: c.tris, g, ...chartBounds(g, c.tris) }));
  }
  if (!charts.length) throw new Error('k.uv.atlas: no charts');
  const order = charts.map((c, i) => i).sort((a, b) => charts[b].h - charts[a].h || charts[b].w - charts[a].w || a - b);
  const attempt = (density) => {
    const rects = order.map((ci) => ({ index: ci, w: Math.max(1, Math.ceil(charts[ci].w * density)), h: Math.max(1, Math.ceil(charts[ci].h * density)) }));
    return shelfPack(rects, size, padding);
  };
  let density = pxPerMeter;
  let placed;
  if (density) {
    placed = attempt(density);
    if (!placed) throw new Error(`k.uv.atlas: charts do not fit in ${size}px at ${density} px/m with ${padding}px padding — lower pxPerMeter or raise size`);
  } else {
    const maxSide = Math.max(...charts.map((c) => Math.max(c.w, c.h))) || 1;
    let lo = 1e-3;
    let hi = (size - padding * 2) / maxSide;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      if (attempt(mid)) lo = mid;
      else hi = mid;
    }
    density = lo;
    placed = attempt(density);
    if (!placed) throw new Error('k.uv.atlas: packing failed');
  }
  const layoutCharts = [];
  for (let ci = 0; ci < charts.length; ci++) {
    const c = charts[ci];
    const rect = placed[ci];
    const uv = c.g.attributes.uv.array;
    for (const t of c.tris) {
      for (let k = 0; k < 3; k++) {
        const i = (t * 3 + k) * 2;
        uv[i] = (rect.x + (uv[i] - c.minU) * density) / size;
        uv[i + 1] = (rect.y + (uv[i + 1] - c.minV) * density) / size;
      }
    }
    c.g.attributes.uv.needsUpdate = true;
    c.g.userData.atlas = { size, padding };
    layoutCharts.push({ entry: c.entry, index: c.index, axis: c.axis, rect, uvRect: [rect.x / size, rect.y / size, (rect.x + rect.w) / size, (rect.y + rect.h) / size] });
  }
  return {
    size,
    padding,
    pxPerMeter: density,
    charts: layoutCharts,
    /** Pixel rects of an entry's charts, optionally only those facing `axis` ('+z' = front). */
    rects(entry, axis) {
      return layoutCharts.filter((c) => c.entry === entry && (!axis || c.axis === axis)).map((c) => c.rect);
    },
    /** Largest pixel rect of an entry (optionally by axis). */
    rect(entry, axis) {
      const list = this.rects(entry, axis);
      if (!list.length) throw new Error(`atlas layout: no chart for '${entry}'${axis ? ` facing ${axis}` : ''}`);
      return list.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
    },
  };
}
