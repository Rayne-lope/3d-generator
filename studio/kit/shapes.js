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
