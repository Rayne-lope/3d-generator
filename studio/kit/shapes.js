// 2D shapes for k.geo.extrude (and architecture helpers). Units are meters; shapes are
// drawn in the XY plane with +Y up and are centered unless stated otherwise.

import * as THREE from 'three';

/** Rectangle centered at the origin, optional rounded corners. */
export function rect(w, h, { radius = 0, segments = 4 } = {}) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) {
    s.moveTo(x, y);
    s.lineTo(x + w, y);
    s.lineTo(x + w, y + h);
    s.lineTo(x, y + h);
    s.closePath();
    return s;
  }
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  s.userData = { curveSegments: segments };
  return s;
}

/** Circle centered at the origin. */
export function circle(r, segments = 32) {
  const s = new THREE.Shape();
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

/** Polygon from [[x, y], ...] (counter-clockwise preferred). */
export function polygon(points) {
  if (points.length < 3) throw new Error('k.shape.polygon: need at least 3 points');
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

/** Regular polygon with n sides and circumradius r. */
export function ngon(n, r, rotation = 0) {
  return polygon(Array.from({ length: n }, (_, i) => {
    const a = rotation + (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }));
}

/** Arch: width w, total height h, semicircular top, base at y = 0, centered on x. */
export function arch(w, h, { segments = 16 } = {}) {
  const r = w / 2;
  const straight = Math.max(0, h - r);
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, straight);
  for (let i = 1; i <= segments; i++) {
    const a = (i / segments) * Math.PI;
    s.lineTo(Math.cos(a) * r, straight + Math.sin(a) * r);
  }
  s.lineTo(-r, 0);
  s.closePath();
  return s;
}

/** Star with n points. */
export function star(n, rOuter, rInner) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return polygon(pts);
}

/** Gear outline: `teeth` teeth between radius rRoot and rOuter. */
export function gear(teeth, rOuter, rRoot, { toothFraction = 0.45 } = {}) {
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const half = (step * toothFraction) / 2;
    const flank = step * 0.08;
    pts.push([Math.cos(a0 - half - flank) * rRoot, Math.sin(a0 - half - flank) * rRoot]);
    pts.push([Math.cos(a0 - half) * rOuter, Math.sin(a0 - half) * rOuter]);
    pts.push([Math.cos(a0 + half) * rOuter, Math.sin(a0 + half) * rOuter]);
    pts.push([Math.cos(a0 + half + flank) * rRoot, Math.sin(a0 + half + flank) * rRoot]);
  }
  return polygon(pts);
}

/** Translate a shape (returns a new shape). */
export function moveShape(shape, dx, dy) {
  const pts = shape.getPoints(shape.userData?.curveSegments || 12).map((p) => [p.x + dx, p.y + dy]);
  // Remove the duplicated closing point.
  if (pts.length > 1) {
    const [fx, fy] = pts[0];
    const [lx, ly] = pts[pts.length - 1];
    if (Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9) pts.pop();
  }
  return polygon(pts);
}

/** Add holes to a shape. Holes must lie fully inside the outline and not overlap. */
export function withHoles(shape, ...holes) {
  for (const h of holes.flat()) {
    const path = new THREE.Path();
    const pts = h.getPoints(h.userData?.curveSegments || 12);
    path.setFromPoints(pts);
    shape.holes.push(path);
  }
  return shape;
}

// ------------------------------------------------------------------ hard-surface outlines

const EPS = 1e-9;

/** Normalize input points to { x, y, size, style } and drop duplicates and straight-through points. */
function cleanPoints(points, { closed = true, size = 0, corner = 'fillet' } = {}) {
  let pts = points.map((p) => (Array.isArray(p)
    ? { x: p[0], y: p[1], size: p[2] ?? size, style: p[3] ?? corner }
    : { x: p.x, y: p.y, size: p.size ?? size, style: p.style ?? corner }));
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('k.shape: every point needs finite [x, y]');
    if (p.style !== 'fillet' && p.style !== 'chamfer') throw new Error(`k.shape: corner style must be 'fillet' or 'chamfer' (got '${p.style}')`);
  }
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = pts[(i - 1 + n) % n];
      const p = pts[i];
      const b = pts[(i + 1) % n];
      const ax = p.x - a.x; const ay = p.y - a.y;
      const bx = b.x - p.x; const by = b.y - p.y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      const cross = ax * by - ay * bx;
      const dot = ax * bx + ay * by;
      // Duplicate point, or collinear and continuing in the same direction.
      if (la < EPS || lb < EPS || (Math.abs(cross) <= 1e-7 * la * lb && dot > 0)) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Corner treatment at p between neighbours a and b: returns the replacement points. */
function cornerPoints(a, p, b, segments) {
  if (!(p.size > 0)) return [[p.x, p.y]];
  const ax = a.x - p.x; const ay = a.y - p.y;
  const bx = b.x - p.x; const by = b.y - p.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  const ua = [ax / la, ay / la];
  const ub = [bx / lb, by / lb];
  const cos = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1]));
  const theta = Math.acos(cos); // angle between the two edges at p
  if (theta > Math.PI - 1e-4) return [[p.x, p.y]];
  if (p.style === 'chamfer') {
    const d = Math.min(p.size, la / 2, lb / 2);
    return [[p.x + ua[0] * d, p.y + ua[1] * d], [p.x + ub[0] * d, p.y + ub[1] * d]];
  }
  const tanHalf = Math.tan(theta / 2);
  const t = Math.min(p.size / tanHalf, la / 2, lb / 2);
  const r = t * tanHalf;
  const bis = [ua[0] + ub[0], ua[1] + ub[1]];
  const bl = Math.hypot(bis[0], bis[1]) || 1;
  const dist = r / Math.sin(theta / 2);
  const cx = p.x + (bis[0] / bl) * dist;
  const cy = p.y + (bis[1] / bl) * dist;
  const s = [p.x + ua[0] * t, p.y + ua[1] * t];
  const e = [p.x + ub[0] * t, p.y + ub[1] * t];
  let a0 = Math.atan2(s[1] - cy, s[0] - cx);
  let a1 = Math.atan2(e[1] - cy, e[0] - cx);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const n = Math.max(1, Math.ceil((segments * Math.abs(sweep)) / (Math.PI / 2)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const ang = a0 + (sweep * i) / n;
    out.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
  }
  void a1;
  return out;
}

function dedupe(list, closed) {
  const out = [];
  for (const q of list) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-7) out.push(q);
  }
  if (closed && out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-7) out.pop();
  return out;
}

/** [[x, y], …] of a shape's outline (closing duplicate removed). */
export function outlinePoints(shape) {
  const pts = shape.getPoints(shape.userData?.curveSegments || 12).map((p) => [p.x, p.y]);
  return dedupe(pts, true);
}

/**
 * Outline with a fillet or chamfer per corner: points [x, y] or [x, y, size] or
 * [x, y, size, 'fillet' | 'chamfer']. `size` (and `corner`) set the default for points without
 * their own. Collinear and duplicate points are removed, so extrusions never get zero-area
 * caps. Sizes are clamped to half the shorter neighbouring edge.
 */
export function rounded(points, { size = 0, corner = 'fillet', segments = 6 } = {}) {
  const pts = cleanPoints(points, { size, corner });
  if (pts.length < 3) throw new Error('k.shape.rounded: needs at least 3 points that are not on one line');
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) out.push(...cornerPoints(pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n], segments));
  const final = cleanPoints(dedupe(out, true), { size: 0 }).map((p) => [p.x, p.y]);
  return polygon(final);
}

/** Same as rounded() with 45° cut corners: the hard-surface / sci-fi plate look. */
export function chamfered(points, { size = 0, segments = 6 } = {}) {
  return rounded(points, { size, corner: 'chamfer', segments });
}

/** Smooth closed outline through the points (Catmull-Rom): grips, organic shells. */
export function spline(points, { segments = 64, tension = 0.5 } = {}) {
  if (points.length < 3) throw new Error('k.shape.spline: needs at least 3 points');
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], 0)), true, 'catmullrom', tension);
  const pts = dedupe(curve.getPoints(segments).map((v) => [v.x, v.y]), true);
  return polygon(pts);
}

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

function offsetLoop(pts, d, closed) {
  // Offset each edge along its left normal by d, then intersect neighbouring edges (miter,
  // limited to 3·|d| so sharp spikes become bevels).
  const n = pts.length;
  const edges = [];
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    edges.push({ a: [a[0] + nx * d, a[1] + ny * d], b: [b[0] + nx * d, b[1] + ny * d], dir: [dx / l, dy / l] });
  }
  const out = [];
  const cross = (e1, e2) => {
    const den = e1.dir[0] * e2.dir[1] - e1.dir[1] * e2.dir[0];
    if (Math.abs(den) < 1e-9) return null;
    const t = ((e2.a[0] - e1.a[0]) * e2.dir[1] - (e2.a[1] - e1.a[1]) * e2.dir[0]) / den;
    return [e1.a[0] + e1.dir[0] * t, e1.a[1] + e1.dir[1] * t];
  };
  const meet = (e1, e2) => {
    const q = cross(e1, e2);
    if (!q) return [e1.b];
    if (Math.hypot(q[0] - e1.b[0], q[1] - e1.b[1]) > 3 * Math.abs(d)) return [e1.b, e2.a];
    return [q];
  };
  // Short edges (small chamfers) can shrink past zero and turn around: drop them so their
  // neighbours meet directly, otherwise the loop gets near-duplicate points and slivers.
  while (closed && edges.length > 3) {
    const m = edges.length;
    const at = (i) => cross(edges[(i - 1 + m) % m], edges[i]) || edges[i].a;
    const flipped = edges.findIndex((e, i) => {
      const v0 = at(i);
      const v1 = at((i + 1) % m);
      return (v1[0] - v0[0]) * e.dir[0] + (v1[1] - v0[1]) * e.dir[1] <= 1e-9;
    });
    if (flipped < 0) break;
    edges.splice(flipped, 1);
  }
  if (!closed) out.push(edges[0].a);
  for (let i = 0; i < edges.length; i++) {
    if (!closed && i === edges.length - 1) break;
    out.push(...meet(edges[i], edges[(i + 1) % edges.length]));
  }
  if (!closed) out.push(edges[edges.length - 1].b);
  return out;
}

/**
 * Grow (distance > 0) or shrink (distance < 0) an outline: inset panels, plate layers, trims.
 * Meant for offsets small compared with the shape (a few mm on a 10 cm plate).
 */
export function offset(shape, distance) {
  let pts = outlinePoints(shape);
  if (signedArea(pts) < 0) pts = pts.reverse();
  // Left normal of a counter-clockwise loop points inward, so outward = -d.
  const out = dedupe(offsetLoop(pts, -distance, true), true);
  if (out.length < 3 || signedArea(out) <= 0) throw new Error(`k.shape.offset: offset ${distance} collapses the shape (make it smaller)`);
  return polygon(out);
}

/**
 * An open path turned into a band `width` wide (glow strips, trims, piping that follow a
 * plate outline). Bends get the same fillet/chamfer treatment as rounded().
 */
export function polyline(points, { width = 0.004, size = 0, corner = 'chamfer', segments = 4 } = {}) {
  if (!(width > 0)) throw new Error('k.shape.polyline: width must be > 0');
  const pts = cleanPoints(points, { closed: false, size, corner });
  if (pts.length < 2 || (pts.length === 2 && Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < EPS)) throw new Error('k.shape.polyline: needs at least 2 distinct points');
  const path = [[pts[0].x, pts[0].y]];
  for (let i = 1; i < pts.length - 1; i++) path.push(...cornerPoints(pts[i - 1], pts[i], pts[i + 1], segments));
  path.push([pts[pts.length - 1].x, pts[pts.length - 1].y]);
  const line = dedupe(path, false);
  const left = offsetLoop(line, width / 2, false);
  const right = offsetLoop(line, -width / 2, false).reverse();
  return polygon(dedupe([...left, ...right], true));
}
