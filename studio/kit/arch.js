// Architecture helpers: walls with door/window openings, trims, roofs and stairs.
// All pieces are closed solids with real thickness (no single-sided planes), built from
// extruded outlines so openings have clean reveals without boolean artifacts.
// Walls stand on y = 0, are centered on x, and their thickness runs along z.

import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { extrude } from './geo.js';
import { flat } from './ops.js';
import { box as boxUV } from './uv.js';

/** Common real-world dimensions in meters (residential, human scale 1.75 m). */
export const dims = {
  door: { w: 0.9, h: 2.1 },
  doubleDoor: { w: 1.6, h: 2.1 },
  window: { w: 1.0, h: 1.2, sill: 0.9 },
  storyHeight: 3.0,
  ceilingClear: 2.6,
  wallExterior: 0.28,
  wallInterior: 0.12,
  stairRiser: 0.18,
  stairTread: 0.28,
  railing: 1.0,
  tableHeight: 0.75,
  seatHeight: 0.45,
  counterHeight: 0.9,
  humanHeight: 1.75,
};

function rectPts(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function archPts(cx, y0, w, h, segments = 12) {
  const r = w / 2;
  const straight = Math.max(0, h - r);
  const pts = [[cx - r, y0], [cx + r, y0], [cx + r, y0 + straight]];
  for (let i = 1; i < segments; i++) {
    const a = (i / segments) * Math.PI;
    pts.push([cx + Math.cos(a) * r, y0 + straight + Math.sin(a) * r]);
  }
  pts.push([cx - r, y0 + straight]);
  return pts;
}

function toPath(pts) {
  const path = new THREE.Path();
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
  path.closePath();
  return path;
}

/**
 * Wall with openings.
 * openings: [{ x (center along width), y (bottom), w, h, shape?: 'rect'|'arch' }]
 * Openings with y = 0 are doors (cut from the bottom edge); others are windows (holes).
 * gableHeight > 0 adds a triangular gable on top (for walls under a gable roof).
 */
export function wall({ width, height, thickness = dims.wallExterior, openings = [], gableHeight = 0, uvScale = 1 } = {}) {
  if (!(width > 0 && height > 0 && thickness > 0)) throw new Error('k.arch.wall: width, height and thickness must be > 0');
  const hw = width / 2;
  const margin = 0.05;
  const doors = [];
  const windows = [];
  for (const o of openings) {
    const shape = o.shape || 'rect';
    if (o.w <= 0 || o.h <= 0) throw new Error('k.arch.wall: opening w/h must be > 0');
    if (o.x - o.w / 2 < -hw + margin || o.x + o.w / 2 > hw - margin) throw new Error(`k.arch.wall: opening at x=${o.x} (w=${o.w}) is outside the wall (keep ${margin} m from the edges)`);
    if (o.y + o.h > height - margin) throw new Error(`k.arch.wall: opening top ${o.y + o.h} is above the wall height ${height} (keep ${margin} m)`);
    if ((o.y ?? 0) <= 1e-4) doors.push({ ...o, y: 0, shape });
    else windows.push({ ...o, shape });
  }
  const all = [...doors, ...windows].sort((a, b) => a.x - b.x);
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1];
    const b = all[i];
    if (a.x + a.w / 2 + margin > b.x - b.w / 2 && !(a.y + a.h < b.y || b.y + b.h < a.y)) throw new Error('k.arch.wall: openings overlap or are closer than 5 cm');
  }
  // Outline: bottom edge left→right with door notches, then up and over the top.
  const outline = [[-hw, 0]];
  for (const d of doors.sort((a, b) => a.x - b.x)) {
    if (d.shape === 'arch') {
      const pts = archPts(d.x, 0, d.w, d.h);
      // archPts runs counter-clockwise starting bottom-left; walk it clockwise for the notch.
      outline.push([d.x - d.w / 2, 0], [d.x - d.w / 2, Math.max(0, d.h - d.w / 2)]);
      const inner = pts.slice(3, pts.length - 1).reverse();
      outline.push(...inner);
      outline.push([d.x + d.w / 2, Math.max(0, d.h - d.w / 2)], [d.x + d.w / 2, 0]);
    } else {
      outline.push([d.x - d.w / 2, 0], [d.x - d.w / 2, d.h], [d.x + d.w / 2, d.h], [d.x + d.w / 2, 0]);
    }
  }
  outline.push([hw, 0], [hw, height]);
  if (gableHeight > 0) outline.push([0, height + gableHeight]);
  outline.push([-hw, height]);
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], outline[i][1]);
  shape.closePath();
  for (const w of windows) {
    shape.holes.push(toPath(w.shape === 'arch' ? archPts(w.x, w.y, w.w, w.h) : rectPts(w.x - w.w / 2, w.y, w.x + w.w / 2, w.y + w.h)));
  }
  return extrude(shape, thickness, { axis: 'z', uvScale, crease: 30 });
}

/**
 * Trim/frame around an opening of size w×h (inner size). border = trim width, depth = how far it sticks out.
 * bottom: false for door casings (U-shape). Returns geometry centered on x, bottom at y = 0 (inner bottom).
 */
export function frame({ w, h, border = 0.08, depth = 0.06, bottom = true, shape = 'rect', uvScale = 1 } = {}) {
  const b = border;
  let s;
  if (shape === 'arch') {
    const spring = Math.max(0, h - w / 2);
    const rIn = w / 2;
    const rOut = w / 2 + b;
    const seg = 14;
    const innerArc = [];
    const outerArc = [];
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI - (i / seg) * Math.PI;
      innerArc.push([Math.cos(a) * rIn, spring + Math.sin(a) * rIn]);
      outerArc.push([Math.cos(Math.PI - a) * rOut, spring + Math.sin(Math.PI - a) * rOut]);
    }
    s = new THREE.Shape();
    if (bottom) {
      const outer = [[-rOut, -b], [rOut, -b], ...outerArc];
      s.moveTo(outer[0][0], outer[0][1]);
      for (let i = 1; i < outer.length; i++) s.lineTo(outer[i][0], outer[i][1]);
      s.closePath();
      s.holes.push(toPath([[-rIn, 0], [rIn, 0], ...innerArc.slice().reverse()]));
    } else {
      const pts = [[-rOut, 0], [-rIn, 0], ...innerArc, [rIn, 0], [rOut, 0], ...outerArc];
      s.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
      s.closePath();
    }
  } else if (bottom) {
    s = new THREE.Shape();
    const o = rectPts(-w / 2 - b, -b, w / 2 + b, h + b);
    s.moveTo(o[0][0], o[0][1]);
    for (let i = 1; i < o.length; i++) s.lineTo(o[i][0], o[i][1]);
    s.closePath();
    s.holes.push(toPath(rectPts(-w / 2, 0, w / 2, h)));
  } else {
    const pts = [[-w / 2 - b, 0], [-w / 2, 0], [-w / 2, h], [w / 2, h], [w / 2, 0], [w / 2 + b, 0], [w / 2 + b, h + b], [-w / 2 - b, h + b]];
    s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
  }
  return extrude(s, depth, { axis: 'z', uvScale, crease: 30 });
}

/**
 * Roof solid. The outer roof surface passes through the wall-top line at z = ±depth/2,
 * y = 0: place it at the top of the walls. type: 'gable' | 'hip' | 'shed' | 'flat'.
 * height = ridge rise above the wall top (or use pitch in degrees).
 * The ridge of gable/hip roofs runs along X (width).
 */
export function roof({ type = 'gable', width, depth, height = null, pitch = 35, overhang = 0.3, thickness = 0.15, uvScale = 1 } = {}) {
  if (!(width > 0 && depth > 0)) throw new Error('k.arch.roof: width and depth must be > 0');
  if (type === 'flat') {
    const g = flat(boxUV(new THREE.BoxGeometry(width + 2 * overhang, thickness, depth + 2 * overhang).toNonIndexed(), { scale: uvScale }));
    g.translate(0, thickness / 2, 0);
    return g;
  }
  const run = type === 'shed' ? depth : depth / 2;
  const rise = height ?? Math.tan((pitch * Math.PI) / 180) * run;
  const t = rise / run;
  const cos = Math.cos(Math.atan(t));
  const v = thickness / cos;
  const oh = overhang;
  if (type === 'gable') {
    const hd = depth / 2 + oh;
    const e = -oh * t;
    const pts = [[hd, e - v], [hd, e], [0, rise], [-hd, e], [-hd, e - v], [0, rise - v]];
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    // Shape x = house z (mirrored by the rotation; the section is symmetric).
    return extrude(s, width + 2 * oh, { axis: 'x', uvScale, crease: 20 });
  }
  if (type === 'shed') {
    // Low edge at the front (+Z), high edge at the back (-Z).
    const zf = depth / 2 + oh;
    const zb = -depth / 2 - oh;
    const yf = -oh * t;
    const yb = rise + oh * t;
    // Shape x = -z because extrude axis 'x' maps shape x → -z.
    const pts = [[-zf, yf - v], [-zb, yb - v], [-zb, yb], [-zf, yf]];
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    return extrude(s, width + 2 * oh, { axis: 'x', uvScale, crease: 20 });
  }
  if (type === 'hip') {
    const hw = width / 2 + oh;
    const hd = depth / 2 + oh;
    const e = -oh * t;
    const ridgeHalf = Math.max(0, width / 2 - depth / 2);
    const pts = [
      [-hw, e, -hd], [hw, e, -hd], [hw, e, hd], [-hw, e, hd],
      [-hw, e - v, -hd], [hw, e - v, -hd], [hw, e - v, hd], [-hw, e - v, hd],
      [-ridgeHalf, rise, 0], [ridgeHalf, rise, 0],
    ].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    if (ridgeHalf === 0) pts.push(new THREE.Vector3(0, rise, -1e-4), new THREE.Vector3(0, rise, 1e-4));
    const g = flat(boxUV(new ConvexGeometry(pts), { scale: uvScale }));
    return g;
  }
  throw new Error(`k.arch.roof: unknown type '${type}' (gable | hip | shed | flat)`);
}

/**
 * Solid staircase rising toward -Z: total `height`, total run `depth`, `steps` steps.
 * Front (lowest step) at z = +depth/2, bottom at y = 0.
 */
export function stairs({ width = 1, height = 1, depth = null, steps = null, uvScale = 1 } = {}) {
  const n = steps || Math.max(1, Math.round(height / dims.stairRiser));
  const run = depth ?? n * dims.stairTread;
  const rh = height / n;
  const rd = run / n;
  // Profile in (shape x = -z, y) because extrude axis 'x' maps shape x → -z.
  const pts = [[-run / 2, 0]];
  for (let i = 0; i < n; i++) {
    const z = run / 2 - i * rd;
    pts.push([-z, (i + 1) * rh]);
    pts.push([-(z - rd), (i + 1) * rh]);
  }
  pts.push([run / 2, 0]);
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return extrude(s, width, { axis: 'x', uvScale, crease: 20 });
}
