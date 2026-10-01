// UV analysis shared by the validator (padding, overlap, density) and the exporter
// (gutter dilation). Works on triangles given as flat arrays in UV space [0..1].

/**
 * Group triangles into UV islands: triangles sharing an edge with identical UV endpoints.
 * @param {Float32Array|number[]} uvs  per-triangle-vertex UVs, length = triCount * 6
 * @returns {{ids: Int32Array, count: number}}
 */
export function uvIslands(uvs) {
  const triCount = uvs.length / 6;
  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const key = (u, v) => `${Math.round(u * 1e6)}:${Math.round(v * 1e6)}`;
  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    const k = [key(uvs[t * 6], uvs[t * 6 + 1]), key(uvs[t * 6 + 2], uvs[t * 6 + 3]), key(uvs[t * 6 + 4], uvs[t * 6 + 5])];
    for (let e = 0; e < 3; e++) {
      const a = k[e];
      const b = k[(e + 1) % 3];
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      const other = edges.get(ek);
      if (other === undefined) edges.set(ek, t);
      else parent[find(t)] = find(other);
    }
  }
  const remap = new Map();
  const ids = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    if (!remap.has(r)) remap.set(r, remap.size);
    ids[t] = remap.get(r);
  }
  return { ids, count: remap.size };
}

/**
 * Conservative rasterization of UV triangles into a label buffer (texels within half a
 * texel of a triangle count as used: that is what bilinear filtering samples).
 * @returns {{labels: Int32Array, overlap: number, covered: number}}
 */
export function rasterizeIslands(uvs, ids, W, H) {
  const labels = new Int32Array(W * H).fill(-1);
  let overlap = 0;
  let covered = 0;
  const triCount = uvs.length / 6;
  for (let t = 0; t < triCount; t++) {
    const x0 = uvs[t * 6] * W; const y0 = uvs[t * 6 + 1] * H;
    const x1 = uvs[t * 6 + 2] * W; const y1 = uvs[t * 6 + 3] * H;
    const x2 = uvs[t * 6 + 4] * W; const y2 = uvs[t * 6 + 5] * H;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 1));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2) + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 1));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2) + 1));
    if (minX > maxX || minY > maxY) continue;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const sign = area >= 0 ? 1 : -1;
    const edges = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]].map(([ax, ay, bx, by]) => {
      const len = Math.hypot(bx - ax, by - ay);
      return { ax, ay, bx, by, len };
    });
    const label = ids[t];
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        let inside = true;
        if (Math.abs(area) < 1e-9) {
          // Degenerate (e.g. palette swatch points or slivers): distance to the segment/point.
          let d = Infinity;
          for (const e of edges) d = Math.min(d, distSeg(px, py, e));
          inside = d <= 0.75; // a bilinear sample reads the 2x2 texels around a point
        } else {
          for (const e of edges) {
            const cross = ((e.bx - e.ax) * (py - e.ay) - (e.by - e.ay) * (px - e.ax)) * sign;
            const dist = e.len > 0 ? cross / e.len : 0;
            if (dist < -0.5) {
              inside = false;
              break;
            }
          }
        }
        if (!inside) continue;
        const i = y * W + x;
        if (labels[i] === -1) {
          labels[i] = label;
          covered++;
        } else if (labels[i] !== label) {
          overlap++;
        }
      }
    }
  }
  return { labels, overlap, covered };
}

function distSeg(px, py, e) {
  const dx = e.bx - e.ax;
  const dy = e.by - e.ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - e.ax) * dx + (py - e.ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (e.ax + dx * t), py - (e.ay + dy * t));
}

/**
 * Euclidean distance transform with nearest-source tracking (dead reckoning).
 * @returns {{dist: Float32Array, src: Int32Array}}
 */
export function distanceTransform(labels, W, H) {
  const N = W * H;
  const dist = new Float32Array(N).fill(Infinity);
  const src = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (labels[i] >= 0) {
      dist[i] = 0;
      src[i] = i;
    }
  }
  const relax = (p, q) => {
    const s = src[q];
    if (s < 0) return;
    const dx = (p % W) - (s % W);
    const dy = Math.floor(p / W) - Math.floor(s / W);
    const d = Math.hypot(dx, dy);
    if (d < dist[p]) {
      dist[p] = d;
      src[p] = s;
    }
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (x > 0) relax(p, p - 1);
      if (y > 0) {
        relax(p, p - W);
        if (x > 0) relax(p, p - W - 1);
        if (x < W - 1) relax(p, p - W + 1);
      }
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const p = y * W + x;
      if (x < W - 1) relax(p, p + 1);
      if (y < H - 1) {
        relax(p, p + W);
        if (x < W - 1) relax(p, p + W + 1);
        if (x > 0) relax(p, p + W - 1);
      }
    }
  }
  return { dist, src };
}

/**
 * Smallest gap (in texels) between different UV islands, plus the worst locations.
 * gap = number of empty texels between the closest used texels of two islands.
 */
export function measurePadding(labels, W, H, { limit = 40 } = {}) {
  const { src } = distanceTransform(labels, W, H);
  let minGap = Infinity;
  const pairs = new Map();
  const consider = (p, q) => {
    const sp = src[p];
    const sq = src[q];
    if (sp < 0 || sq < 0) return;
    const la = labels[sp];
    const lb = labels[sq];
    if (la === lb) return;
    const gap = Math.max(0, Math.hypot((sp % W) - (sq % W), Math.floor(sp / W) - Math.floor(sq / W)) - 1);
    if (gap < minGap) minGap = gap;
    const key = la < lb ? `${la}-${lb}` : `${lb}-${la}`;
    const cur = pairs.get(key);
    if (!cur || gap < cur.gap) pairs.set(key, { x: p % W, y: Math.floor(p / W), gap: Math.round(gap * 10) / 10, a: la, b: lb });
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (x < W - 1) consider(p, p + 1);
      if (y < H - 1) consider(p, p + W);
    }
  }
  const locations = [...pairs.values()].sort((m, n) => m.gap - n.gap).slice(0, limit);
  return { minGap: Number.isFinite(minGap) ? minGap : null, locations };
}

/**
 * Fill unused texels with the color of the nearest used texel, up to `radius` texels
 * (edge padding / gutter dilation). Prevents background colors from bleeding into
 * islands when engines build mipmaps or downscale the texture.
 */
export function dilate(rgba, labels, W, H, radius = 16) {
  const { dist, src } = distanceTransform(labels, W, H);
  const out = new Uint8Array(rgba);
  for (let p = 0; p < W * H; p++) {
    if (labels[p] >= 0 || src[p] < 0 || dist[p] > radius) continue;
    const s = src[p];
    out[p * 4] = rgba[s * 4];
    out[p * 4 + 1] = rgba[s * 4 + 1];
    out[p * 4 + 2] = rgba[s * 4 + 2];
    out[p * 4 + 3] = rgba[s * 4 + 3];
  }
  return out;
}
