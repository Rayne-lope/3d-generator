// Buildings from masses, in three steps with plain data in between:
//
//   plan(spec)      → masses → sides → bays × floors → slots (door / window). Pure data:
//                     which wall parts are hidden by another mass, where every opening goes.
//   build(plan)     → modules (walls, windows, door, portico, bands, quoins, timber framing,
//                     roofs, dormers, chimneys) placed in each side's local frame and merged into
//                     one geometry per material zone; lowers the detail level until the
//                     triangle budget fits.
//   materials(style)→ one tiling material per zone (bricks, ashlar, slate, plaster, timber…).
//
// building(spec) does all three and returns a k.part. Styles are data (building-styles.js).
//
// Conventions: meters, +Y up, the building's front faces +Z, ground at y = 0. A side's local
// frame: x runs along the facade (left → right seen from outside), y up, z out of the wall's
// outer face (z = 0 on the face).

import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { extrude, box as boxGeo, lathe, cylinder, sphere } from './geo.js';
import { merge, flat } from './ops.js';
import { box as boxUV } from './uv.js';
import { wall as archWall, frame as archFrame, roof as archRoof, stairs as archStairs } from './arch.js';
import { rect as rectShape, polygon, withHoles } from './shapes.js';
import { pbr } from './materials.js';
import { createTexture, normalFromHeight } from './texture.js';
import { part as kPart, mesh as kMesh } from './scene.js';
import { STYLES } from './building-styles.js';

export { STYLES as styles };

export const ZONES = ['wall', 'trim', 'roof', 'frame', 'glass', 'door', 'metal', 'timber', 'chimney', 'shutter'];
const SIDE_NAMES = ['front', 'right', 'back', 'left'];
// Direction along the facade (t) and outward normal (n), as [x, z].
const SIDE = {
  front: { t: [1, 0], n: [0, 1] },
  right: { t: [0, -1], n: [1, 0] },
  back: { t: [-1, 0], n: [0, -1] },
  left: { t: [0, 1], n: [-1, 0] },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [key, v] of Object.entries(over)) out[key] = isObj(v) && isObj(base[key]) ? deepMerge(base[key], v) : v;
  return out;
}

/** A style name, or a style object (optionally `{ extends: 'georgian', …overrides }`). */
export function resolveStyle(style = 'georgian') {
  if (typeof style === 'string') {
    if (!STYLES[style]) throw new Error(`k.arch: unknown style '${style}'. Known: ${Object.keys(STYLES).join(', ')} (or pass a style object)`);
    return structuredClone(STYLES[style]);
  }
  if (!isObj(style)) throw new Error('k.arch: style must be a style name or an object');
  const base = style.extends ? resolveStyle(style.extends) : resolveStyle('georgian');
  const { extends: _ignored, ...over } = style;
  return deepMerge(base, over);
}

// ------------------------------------------------------------------------------------- plan

function normMass(m, style, i) {
  if (!(m.width > 0 && m.depth > 0)) throw new Error(`k.arch.plan: mass ${m.id ?? i} needs width > 0 and depth > 0`);
  const floors = Math.max(1, Math.round(m.floors ?? 2));
  const gh = m.groundFloorHeight ?? style.groundFloorHeight;
  const fh = m.floorHeight ?? style.floorHeight;
  const levels = [];
  let y = 0;
  for (let f = 0; f < floors; f++) {
    const h = f === 0 ? gh : fh;
    levels.push({ y, h });
    y += h;
  }
  const roof = deepMerge(style.roof, m.roof || {});
  roof.ridge = roof.ridge || (m.width >= m.depth ? 'x' : 'z');
  const jetty = m.jetty === undefined ? style.jetty : m.jetty;
  return {
    id: m.id ?? (i === 0 ? 'main' : `mass${i}`),
    x: m.x ?? 0,
    z: m.z ?? 0,
    width: m.width,
    depth: m.depth,
    floors,
    levels,
    height: y,
    roof,
    jetty: jetty || null,
    bays: m.bays || {},
    blank: m.blank || {},
    chimneys: m.chimneys,
    dormers: m.dormers,
  };
}

/** Footprint of a mass at floor f (jettied floors grow on their jetty sides). */
export function massRect(m, f = 0) {
  const a = m.jetty ? m.jetty.amount * f : 0;
  const s = m.jetty?.sides || [];
  return {
    x0: m.x - m.width / 2 - (s.includes('left') ? a : 0),
    x1: m.x + m.width / 2 + (s.includes('right') ? a : 0),
    z0: m.z - m.depth / 2 - (s.includes('back') ? a : 0),
    z1: m.z + m.depth / 2 + (s.includes('front') ? a : 0),
  };
}

function sideGeom(name, r) {
  switch (name) {
    case 'front': return { start: [r.x0, r.z1], length: r.x1 - r.x0 };
    case 'right': return { start: [r.x1, r.z1], length: r.z1 - r.z0 };
    case 'back': return { start: [r.x1, r.z0], length: r.x1 - r.x0 };
    default: return { start: [r.x0, r.z0], length: r.z1 - r.z0 };
  }
}

/** How far a side's start moved at floor f compared with floor 0 (jetty on the previous side). */
function startShift(m, side, f) {
  const a = m.jetty ? m.jetty.amount * f : 0;
  const s = m.jetty?.sides || [];
  const prev = { front: 'left', right: 'front', back: 'right', left: 'back' }[side];
  return s.includes(prev) ? a : 0;
}

/** World matrix of a side's local frame at position u along it (and y, z offsets). */
function sideMatrix(side, r, u = 0, y = 0, out = 0) {
  const { start } = sideGeom(side, r);
  const { t, n } = SIDE[side];
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(t[0], 0, t[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(n[0], 0, n[1]));
  m.setPosition(start[0] + t[0] * u + n[0] * out, y, start[1] + t[1] * u + n[1] * out);
  return m;
}

/** Intervals [u0, u1] of a side (at floor f) that lie inside another mass tall enough to hide them. */
function hiddenIntervals(A, side, f, masses) {
  const r = massRect(A, f);
  const { start, length } = sideGeom(side, r);
  const { t, n } = SIDE[side];
  const mid = A.levels[f].y + A.levels[f].h / 2;
  const eps = 0.02;
  const px = start[0] + n[0] * eps;
  const pz = start[1] + n[1] * eps;
  const out = [];
  for (const B of masses) {
    if (B === A || B.height < mid) continue;
    const br = massRect(B, 0);
    let lo = -Infinity;
    let hi = Infinity;
    for (const [p, d, a, b] of [[px, t[0], br.x0, br.x1], [pz, t[1], br.z0, br.z1]]) {
      if (Math.abs(d) < 1e-9) {
        if (p <= a || p >= b) { lo = 1; hi = 0; }
      } else {
        let u0 = (a - p) / d;
        let u1 = (b - p) / d;
        if (u0 > u1) [u0, u1] = [u1, u0];
        lo = Math.max(lo, u0);
        hi = Math.min(hi, u1);
      }
    }
    lo = Math.max(lo, 0);
    hi = Math.min(hi, length);
    if (hi > lo + 1e-6) out.push([lo, hi]);
  }
  return out;
}

const overlaps = (hidden, a, b) => hidden.some(([h0, h1]) => h1 > a && h0 < b);
function coveredLength(hidden, length) {
  const sorted = hidden.slice().sort((p, q) => p[0] - q[0]);
  let total = 0;
  let end = 0;
  for (const [a, b] of sorted) {
    const s = Math.max(a, end);
    if (b > s) total += b - s;
    end = Math.max(end, b);
  }
  return Math.min(total, length);
}

function floorRole(m, f, style) {
  if (f === 0) return 'ground';
  if (f === m.floors - 1) return 'top';
  if (f === 1 && style.windows.noble) return 'noble';
  return 'upper';
}

/** Window spec for a floor role: defaults ← upper ← role. */
export function windowSpec(style, role) {
  const chain = [style.windowDefaults || {}, style.windows.upper || {}];
  if (role !== 'upper' && style.windows[role]) chain.push(style.windows[role]);
  if (role === 'top' && !style.windows.top && style.windows.upper) chain.push({});
  return chain.reduce((a, b) => deepMerge(a, b), {});
}

/**
 * Lay out a building: masses, the bays of every side, and a slot for every opening.
 * @param {object} spec { style, masses: [{ id, x, z, width, depth, floors, roof, bays, blank, jetty }], entrance: { mass, side, bay }, portico, finishes }
 */
export function plan(spec = {}) {
  let style = resolveStyle(spec.style ?? 'georgian');
  if (spec.finishes) style = deepMerge(style, { finishes: spec.finishes });
  if (spec.portico !== undefined) style.portico = spec.portico;
  if (!Array.isArray(spec.masses) || !spec.masses.length) throw new Error('k.arch.plan: pass masses: [{ width, depth, floors, … }]');
  const masses = spec.masses.map((m, i) => normMass(m, style, i));
  const ids = new Set();
  for (const m of masses) {
    if (ids.has(m.id)) throw new Error(`k.arch.plan: two masses are called '${m.id}'`);
    ids.add(m.id);
  }
  const entrance = { mass: masses[0].id, side: 'front', ...(spec.entrance || {}) };
  if (!ids.has(entrance.mass)) throw new Error(`k.arch.plan: entrance mass '${entrance.mass}' does not exist`);
  const slots = [];
  for (const m of masses) {
    m.sides = {};
    for (const side of SIDE_NAMES) {
      const base = sideGeom(side, massRect(m, 0));
      const bay = { ...style.bay, ...(m.bay || {}) };
      const isEntrance = entrance.mass === m.id && entrance.side === side;
      const usable = base.length - 2 * bay.margin;
      let n = m.bays[side] ?? (usable >= bay.min * 0.75 ? Math.max(1, Math.round(usable / bay.width)) : 0);
      if (n > 0 && bay.symmetric && isEntrance && m.bays[side] === undefined && n % 2 === 0) {
        n = usable / (n + 1) >= bay.min ? n + 1 : Math.max(1, n - 1);
      }
      const bw = n ? usable / n : 0;
      const centers = Array.from({ length: n }, (_, i) => bay.margin + bw * (i + 0.5));
      const doorBay = entrance.bay ?? Math.floor((n - 1) / 2);
      const blank = new Set(m.blank[side] || []);
      const floors = [];
      for (let f = 0; f < m.floors; f++) {
        const hidden = hiddenIntervals(m, side, f, masses);
        const shift = startShift(m, side, f);
        const length = sideGeom(side, massRect(m, f)).length;
        floors.push({ hidden, shift, length, visible: coveredLength(hidden, length) < length - 0.05 });
        const role = floorRole(m, f, style);
        for (let i = 0; i < n; i++) {
          if (blank.has(i)) continue;
          const door = isEntrance && f === 0 && i === doorBay;
          const w = door ? style.door.w : windowSpec(style, role).w;
          const u = centers[i] + shift;
          if (overlaps(hidden, u - w / 2 - 0.25, u + w / 2 + 0.25)) continue;
          slots.push({ id: `${m.id}:${side}:${f}:${i}`, mass: m.id, side, floor: f, bay: i, bays: n, role: door ? 'door' : 'window', floorRole: role, u, bayWidth: bw });
        }
      }
      m.sides[side] = { bays: n, bayWidth: bw, centers, floors, entrance: isEntrance };
    }
  }
  return { style, masses, slots, entrance };
}

// ------------------------------------------------------------------------------------ build

/** Collects geometries per zone; modules are cached and reused by key. */
class Collector {
  constructor() {
    this.zones = {};
  }

  add(zone, g, matrix = null) {
    if (!g) return;
    const c = g.clone();
    if (matrix) c.applyMatrix4(matrix);
    (this.zones[zone] ||= []).push(c);
  }

  addAll(parts, matrix) {
    for (const [zone, list] of Object.entries(parts)) for (const g of list) this.add(zone, g, matrix);
  }
}

const at = (g, x = 0, y = 0, z = 0) => {
  g.translate(x, y, z);
  return g;
};
const pushTo = (out, zone, g) => (out[zone] ||= []).push(g);

/** A beam (box) between two points in a local XY plane at depth z. */
function beam(p0, p1, size, depth, z) {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  const g = boxGeo(len, size, depth);
  g.rotateZ(Math.atan2(dy, dx));
  return at(g, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, z);
}

function archOutline(w, h, segments = 12) {
  const r = w / 2;
  const spring = Math.max(0, h - r);
  const pts = [[-r, 0], [r, 0], [r, spring]];
  for (let i = 1; i < segments; i++) {
    const a = (i / segments) * Math.PI;
    pts.push([Math.cos(a) * r, spring + Math.sin(a) * r]);
  }
  pts.push([-r, spring]);
  return pts;
}

/** Window module (local frame: x centered, y from the floor base, z out of the wall face). */
function windowModule(w, d, T) {
  const out = {};
  const { w: W, h: H, sill } = w;
  const b = w.frame.border;
  const fd = w.frame.depth;
  const arch = w.shape === 'arch';
  const inset = Math.min(0.14, T * 0.45);
  pushTo(out, w.frame.zone, at(archFrame({ w: W, h: H, border: b, depth: fd, shape: arch ? 'arch' : 'rect' }), 0, sill, fd / 2 - 0.01));
  const glass = arch ? extrude(polygon(archOutline(W, H)), 0.02, { axis: 'z' }) : at(boxGeo(W, H, 0.02), 0, H / 2, 0);
  pushTo(out, 'glass', at(glass, 0, sill, -inset));
  if (d >= 1 && w.mullions) {
    const [cols, rows] = w.mullions;
    const hRect = arch ? H - W / 2 : H;
    pushTo(out, 'frame', at(archFrame({ w: W - 0.02, h: H - 0.02, border: 0.05, depth: 0.05, shape: arch ? 'arch' : 'rect' }), 0, sill + 0.01, -inset + 0.03));
    for (let c = 1; c < cols; c++) pushTo(out, 'frame', at(boxGeo(0.04, hRect, 0.035), -W / 2 + (W * c) / cols, sill + hRect / 2, -inset + 0.03));
    for (let r = 1; r < rows; r++) pushTo(out, 'frame', at(boxGeo(W, 0.04, 0.035), 0, sill + (hRect * r) / rows, -inset + 0.03));
  }
  if (w.sillBlock) pushTo(out, 'trim', at(boxGeo(W + 2 * b + 0.12, 0.09, fd + 0.1, { bevel: 0.01 }), 0, sill - b - 0.045, (fd + 0.1) / 2 - 0.02));
  const top = sill + H + b;
  const headW = W + 2 * b + 0.1;
  const head = w.head || 'none';
  if (head === 'lintel' || (d === 0 && head !== 'none')) {
    pushTo(out, w.frame.zone === 'timber' ? 'timber' : 'trim', at(boxGeo(headW, 0.16, fd + 0.04, { bevel: 0.01 }), 0, top + 0.08, (fd + 0.04) / 2 - 0.01));
  } else if (head === 'keystone') {
    pushTo(out, 'trim', at(boxGeo(headW, 0.18, fd + 0.03, { bevel: 0.01 }), 0, top + 0.09, (fd + 0.03) / 2 - 0.01));
    const key = extrude(polygon([[-0.1, 0], [0.1, 0], [0.14, 0.34], [-0.14, 0.34]]), fd + 0.08, { axis: 'z' });
    pushTo(out, 'trim', at(key, 0, top - 0.06, (fd + 0.08) / 2 - 0.01));
  } else if (head === 'pediment') {
    pushTo(out, 'trim', at(boxGeo(headW + 0.12, 0.2, fd + 0.05, { bevel: 0.01 }), 0, top + 0.1, (fd + 0.05) / 2 - 0.01));
    pushTo(out, 'trim', at(boxGeo(headW + 0.3, 0.08, fd + 0.14, { bevel: 0.01 }), 0, top + 0.24, (fd + 0.14) / 2 - 0.01));
    const hw = (headW + 0.3) / 2;
    const tri = extrude(polygon([[-hw, 0], [hw, 0], [0, hw * Math.tan(0.33)]]), fd + 0.1, { axis: 'z' });
    pushTo(out, 'trim', at(tri, 0, top + 0.28, (fd + 0.1) / 2 - 0.01));
  } else if (head === 'cornice') {
    pushTo(out, 'trim', at(boxGeo(headW, 0.18, fd + 0.04), 0, top + 0.09, (fd + 0.04) / 2 - 0.01));
    pushTo(out, 'trim', at(boxGeo(headW + 0.25, 0.1, fd + 0.16, { bevel: 0.01 }), 0, top + 0.23, (fd + 0.16) / 2 - 0.01));
  }
  if (d >= 2 && w.shutters) {
    for (const s of [-1, 1]) pushTo(out, 'shutter', at(boxGeo(W / 2 + 0.02, H, 0.04, { bevel: 0.006 }), s * (W / 2 + b + W / 4 + 0.03), sill + H / 2, 0.03));
  }
  if (w.balcony) {
    const bw = W + 2 * b + 0.6;
    const y0 = Math.max(0.02, sill - b - 0.14);
    const dep = w.balcony.depth ?? 0.6;
    const zone = w.balcony.zone || 'metal';
    pushTo(out, 'trim', at(boxGeo(bw, 0.14, dep, { bevel: 0.015 }), 0, y0 + 0.07, dep / 2 - 0.02));
    const rh = 0.95;
    pushTo(out, zone, at(boxGeo(bw, 0.05, 0.05), 0, y0 + 0.14 + rh, dep - 0.04));
    if (d >= 1) {
      const count = Math.max(3, Math.round(bw / (d >= 2 ? 0.13 : 0.3)));
      for (let i = 0; i <= count; i++) {
        const x = -bw / 2 + 0.03 + ((bw - 0.06) * i) / count;
        const post = d >= 2 ? cylinder(0.016, rh, { segments: 6 }) : boxGeo(0.03, rh, 0.03);
        pushTo(out, zone, at(post, x, y0 + 0.14 + rh / 2, dep - 0.04));
      }
      for (const s of [-1, 1]) pushTo(out, zone, at(boxGeo(0.04, 0.05, dep - 0.04), s * (bw / 2 - 0.02), y0 + 0.14 + rh, (dep - 0.04) / 2));
    } else {
      pushTo(out, zone, at(boxGeo(bw, rh, 0.03), 0, y0 + 0.14 + rh / 2, dep - 0.04));
    }
  }
  return out;
}

/** Door module: leaf, fanlight, surround, steps up to the plinth. */
function doorModule(door, d, T, plinthH, steps = true) {
  const out = {};
  const { w, h } = door;
  const fan = door.fanlight ? w / 2 : 0;
  const arch = door.shape === 'arch';
  const inset = Math.min(0.16, T * 0.5);
  const y0 = plinthH;
  const leaf = (lw, x) => {
    const g = arch && !fan ? extrude(polygon(archOutline(lw, h)), 0.06, { axis: 'z' }) : at(boxGeo(lw, h, 0.06), 0, h / 2, 0);
    pushTo(out, 'door', at(g, x, y0, -inset));
    if (d >= 1 && !arch) {
      for (let r = 0; r < 3; r++) {
        const ph = (h - 0.4) / 3 - 0.08;
        pushTo(out, 'door', at(boxGeo(lw - 0.2, ph, 0.03, { bevel: 0.01 }), x, y0 + 0.2 + r * ((h - 0.4) / 3) + ph / 2 + 0.04, -inset + 0.04));
      }
    }
  };
  if (door.leaf === 'double') {
    leaf(w / 2 - 0.01, -w / 4);
    leaf(w / 2 - 0.01, w / 4);
  } else leaf(w, 0);
  if (fan) {
    const r = w / 2;
    const disc = [[r, 0]];
    for (let i = 1; i < 12; i++) disc.push([Math.cos((i / 12) * Math.PI) * r, Math.sin((i / 12) * Math.PI) * r]);
    disc.push([-r, 0]);
    const half = extrude(polygon(disc), 0.02, { axis: 'z' });
    pushTo(out, 'glass', at(half, 0, y0 + h - 0.0, -inset));
    if (d >= 2) pushTo(out, 'frame', at(boxGeo(w, 0.06, 0.05), 0, y0 + h, -inset + 0.03));
  }
  const zone = door.zone || 'trim';
  const hTot = h + fan;
  if (door.surround === 'pilasters' && d >= 1) {
    for (const s of [-1, 1]) pushTo(out, zone, at(boxGeo(0.3, hTot, 0.14, { bevel: 0.012 }), s * (w / 2 + 0.22), y0 + hTot / 2, 0.06));
    pushTo(out, zone, at(boxGeo(w + 1.0, 0.42, 0.2, { bevel: 0.015 }), 0, y0 + hTot + 0.21, 0.09));
    pushTo(out, zone, at(boxGeo(w + 1.2, 0.1, 0.3, { bevel: 0.01 }), 0, y0 + hTot + 0.47, 0.14));
    if (door.pediment) {
      const hw = (w + 1.2) / 2;
      pushTo(out, zone, at(extrude(polygon([[-hw, 0], [hw, 0], [0, hw * Math.tan(0.36)]]), 0.26, { axis: 'z' }), 0, y0 + hTot + 0.52, 0.12));
    }
  } else {
    pushTo(out, zone, at(archFrame({ w, h: hTot, border: 0.16, depth: 0.1, bottom: false, shape: arch || fan ? 'arch' : 'rect' }), 0, y0, 0.04));
  }
  if (steps && plinthH > 0.05) {
    const n = Math.max(1, Math.round(plinthH / 0.17));
    const run = n * 0.32;
    pushTo(out, 'trim', at(archStairs({ width: w + 1.2, height: plinthH, steps: n, depth: run }), 0, 0, run / 2));
  }
  if (d >= 2) pushTo(out, 'metal', at(sphere(0.035, { widthSegments: 8, heightSegments: 6 }), door.leaf === 'double' ? 0.12 : w * 0.38, y0 + 1.05, -inset + 0.07));
  return out;
}

/** Classical column (lathe) of radius r and height h, standing on y = 0. */
function column(r, h, d) {
  const prof = [[0, 0], [r * 1.35, 0], [r * 1.35, 0.14], [r * 1.12, 0.24], [r, 0.32], [r * 0.86, h - 0.42], [r * 1.02, h - 0.32], [r * 1.38, h - 0.16], [r * 1.38, h], [0, h]];
  return lathe(prof, { segments: d >= 2 ? 16 : d >= 1 ? 10 : 6, crease: 50 });
}

/** Portico in front of the entrance: platform, steps, columns, entablature, pediment, roof. */
function porticoModule(pc, width, height, plinthH, d) {
  const out = {};
  const dep = pc.depth ?? 2.6;
  const r = pc.radius ?? 0.32;
  const entH = 0.75;
  const hc = height - plinthH - entH;
  // 12 mm above the plinth so the two top faces never coincide.
  pushTo(out, 'trim', at(boxGeo(width + 0.5, plinthH + 0.012, dep + 0.2, { bevel: 0.02 }), 0, (plinthH + 0.012) / 2, (dep + 0.2) / 2 - 0.05));
  const steps = Math.max(1, Math.round(plinthH / 0.17));
  const run = steps * 0.34;
  pushTo(out, 'trim', at(archStairs({ width: width + 0.5, height: plinthH, steps, depth: run }), 0, 0, dep + 0.15 + run / 2));
  const n = Math.max(2, pc.columns ?? 4);
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + r * 1.5 + ((width - r * 3) * i) / (n - 1);
    pushTo(out, 'trim', at(column(r, hc, d), x, plinthH, dep - r * 1.5));
    if (d >= 1) pushTo(out, 'trim', at(boxGeo(r * 2.2, hc, 0.12, { bevel: 0.01 }), x, plinthH + hc / 2, 0.05));
  }
  const yTop = plinthH + hc;
  pushTo(out, 'trim', at(boxGeo(width + 0.3, entH, dep + 0.25, { bevel: 0.02 }), 0, yTop + entH / 2, (dep + 0.25) / 2 - 0.05));
  pushTo(out, 'trim', at(boxGeo(width + 0.6, 0.14, dep + 0.45, { bevel: 0.015 }), 0, yTop + entH + 0.07, (dep + 0.45) / 2 - 0.05));
  const yRoof = yTop + entH + 0.14;
  if (pc.pediment !== false) {
    const pitch = pc.pitch ?? 20;
    const hw = (width + 0.6) / 2;
    const rise = hw * Math.tan((pitch * Math.PI) / 180);
    pushTo(out, 'trim', at(extrude(polygon([[-hw, 0], [hw, 0], [0, rise]]), 0.3, { axis: 'z' }), 0, yRoof, dep + 0.25));
    const roof = archRoof({ type: 'gable', width: dep + 0.4, depth: width + 0.6, pitch, overhang: 0.12, thickness: 0.16 });
    roof.rotateY(Math.PI / 2);
    pushTo(out, 'roof', at(roof, 0, yRoof + 0.02, (dep + 0.4) / 2 - 0.05));
  } else {
    pushTo(out, 'roof', at(boxGeo(width + 0.6, 0.12, dep + 0.45), 0, yRoof + 0.06, (dep + 0.45) / 2 - 0.05));
  }
  return out;
}

/** Ring band around a footprint: stacked steps [height, projection] from y upward. */
function ringBands(r, y, steps) {
  const out = [];
  const w = r.x1 - r.x0;
  const dd = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  let yy = y;
  for (const [h, proj] of steps) {
    const s = withHoles(rectShape(w + 2 * proj, dd + 2 * proj), rectShape(Math.max(0.1, w - 0.08), Math.max(0.1, dd - 0.08)));
    out.push(at(extrude(s, h, { axis: 'y', crease: 30 }), cx, yy, cz));
    yy += h;
  }
  return out;
}

/** Height of the roof's outer surface above the wall top at a horizontal inset s from a long side. */
function roofRise(roof, s) {
  const pitch = roof.type === 'mansard' ? (roof.lowerPitch ?? 72) : roof.pitch;
  return s * Math.tan((pitch * Math.PI) / 180);
}

/**
 * How far the eave starts outside the wall face: past the cornice and the timber framing, so
 * nothing at the top of the wall pokes through the roof.
 */
function eaveOut(style) {
  const cornice = Math.max(0, ...(style.bands?.cornice || []).map(([, proj]) => proj));
  const timber = style.timber ? (style.timber.depth ?? 0.05) + 0.02 : 0;
  return Math.max(cornice, timber) + 0.06;
}

/** Roof solid for a mass (its eave `out` m outside the walls), plus ridge info. */
function roofModule(m, d, out = 0) {
  const roof = m.roof;
  const top = m.floors - 1;
  const r0 = massRect(m, top);
  const r = { x0: r0.x0 - out, x1: r0.x1 + out, z0: r0.z0 - out, z1: r0.z1 + out };
  const w = r.x1 - r.x0;
  const dd = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const alongX = roof.ridge !== 'z';
  const len = alongX ? w : dd;
  const span = alongX ? dd : w;
  let g;
  let ridgeY;
  if (roof.type === 'mansard') {
    const lp = ((roof.lowerPitch ?? 72) * Math.PI) / 180;
    const lh = roof.lowerHeight ?? 2.6;
    const up = ((roof.upperPitch ?? 18) * Math.PI) / 180;
    const oh = Math.min(roof.overhang ?? 0.1, 0.15);
    const inset = lh / Math.tan(lp);
    const L2 = len / 2 - inset;
    const S2 = span / 2 - inset;
    const rise = Math.tan(up) * S2;
    const ridgeHalf = Math.max(0, L2 - S2);
    const pts = [
      [-len / 2 - oh, 0, -span / 2 - oh], [len / 2 + oh, 0, -span / 2 - oh], [len / 2 + oh, 0, span / 2 + oh], [-len / 2 - oh, 0, span / 2 + oh],
      [-L2, lh, -S2], [L2, lh, -S2], [L2, lh, S2], [-L2, lh, S2],
      [-ridgeHalf, lh + rise, -1e-3], [ridgeHalf, lh + rise, 1e-3],
    ].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    g = flat(boxUV(new ConvexGeometry(pts), { scale: 1 }));
    ridgeY = lh + rise;
  } else {
    g = archRoof({ type: roof.type, width: len, depth: span, pitch: roof.pitch, overhang: roof.overhang, thickness: roof.thickness });
    const run = roof.type === 'shed' ? span : span / 2;
    ridgeY = roof.type === 'flat' ? roof.thickness : Math.tan((roof.pitch * Math.PI) / 180) * run;
  }
  if (!alongX) g.rotateY(Math.PI / 2);
  at(g, cx, m.height, cz);
  const parts = { roof: [g] };
  return { parts, info: { ridgeY: m.height + ridgeY, alongX, len, span, cx, cz, rect: r, out } };
}

/** Dormer module (side-local frame, y absolute from the ground). */
function dormerModule(dm, wallTop, roof, d, eave = 0) {
  const out = {};
  const s = dm.setback ?? 0.8;
  const yb = wallTop + roofRise(roof, s + eave) - 0.05;
  const W = dm.w;
  const H = dm.h;
  const bw = W + 0.5;
  const hb = H + 0.5;
  const db = dm.depth ?? 1.8;
  const zone = dm.zone || 'roof';
  pushTo(out, zone, at(boxGeo(bw, hb, db), 0, yb + hb / 2, -s - db / 2));
  pushTo(out, 'frame', at(archFrame({ w: W, h: H, border: 0.07, depth: 0.08 }), 0, yb + 0.22, -s + 0.03));
  pushTo(out, 'glass', at(boxGeo(W, H, 0.02), 0, yb + 0.22 + H / 2, -s + 0.005));
  if (d >= 1) {
    pushTo(out, 'frame', at(boxGeo(0.04, H, 0.03), 0, yb + 0.22 + H / 2, -s + 0.025));
    pushTo(out, 'frame', at(boxGeo(W, 0.04, 0.03), 0, yb + 0.22 + H * 0.55, -s + 0.025));
  }
  const pitch = 45;
  const rf = archRoof({ type: 'gable', width: db + 0.3, depth: bw, pitch, overhang: 0.12, thickness: 0.09 });
  rf.rotateY(Math.PI / 2);
  pushTo(out, 'roof', at(rf, 0, yb + hb, -s - db / 2 + 0.15));
  const rise = (bw / 2) * Math.tan((pitch * Math.PI) / 180);
  pushTo(out, zone, at(extrude(polygon([[-bw / 2, 0], [bw / 2, 0], [0, rise]]), 0.06, { axis: 'z' }), 0, yb + hb, -s - 0.03));
  return out;
}

/** Timber framing over one floor of one side (local frame, y from the floor base). */
function timberModule(tc, length, h, side, floorSlots, windowFor, d) {
  const out = {};
  const bs = tc.beam ?? 0.2;
  const td = (tc.depth ?? 0.05) + 0.02;
  const z = td / 2 - 0.02;
  const add = (g) => pushTo(out, 'timber', g);
  add(at(boxGeo(length, bs, td), length / 2, bs / 2, z));
  add(at(boxGeo(length, bs, td), length / 2, h - bs / 2, z));
  const posts = new Set([bs / 2, length - bs / 2]);
  const { centers, bayWidth, shift } = side;
  for (let i = 0; i <= centers.length; i++) {
    if (!centers.length) break;
    const u = centers[0] - bayWidth / 2 + i * bayWidth + shift;
    if (u > bs && u < length - bs) posts.add(u);
  }
  for (const u of posts) add(at(boxGeo(bs, h - 2 * bs, td), u, h / 2, z));
  const used = new Set();
  for (const s of floorSlots) {
    used.add(s.bay);
    if (s.role !== 'window') continue;
    const w = windowFor(s);
    const x0 = s.u - s.bayWidth / 2;
    const x1 = s.u + s.bayWidth / 2;
    const ySill = w.sill - w.frame.border - bs / 2;
    const yHead = Math.min(h - bs * 1.5, w.sill + w.h + w.frame.border + bs / 2);
    add(at(boxGeo(s.bayWidth, bs, td), s.u, ySill, z));
    add(at(boxGeo(s.bayWidth, bs, td), s.u, yHead, z));
    if (d >= 2 && tc.braces === 'chevron' && ySill - bs > 0.35) {
      add(beam([x0 + bs / 2, bs], [s.u, ySill - bs / 2], bs * 0.8, td, z));
      add(beam([x1 - bs / 2, bs], [s.u, ySill - bs / 2], bs * 0.8, td, z));
    }
  }
  if (d >= 1) {
    centers.forEach((c, i) => {
      if (used.has(i)) return;
      const x0 = c + shift - bayWidth / 2 + bs / 2;
      const x1 = c + shift + bayWidth / 2 - bs / 2;
      if (x0 < bs || x1 > length - bs) return;
      add(beam([x0, bs], [x1, h - bs], bs * 0.8, td, z));
      add(beam([x1, bs], [x0, h - bs], bs * 0.8, td, z));
    });
  }
  return out;
}

/** The style's door, shrunk if it does not fit the ground floor above the plinth. */
function doorFor(style, floorH, plinthH) {
  const dr = style.door;
  const fan = dr.fanlight ? dr.w / 2 : 0;
  const room = floorH - plinthH - 0.12;
  return dr.h + fan > room ? { ...dr, h: Math.max(1.9, room - fan) } : dr;
}

/** Window spec for a slot; ground-floor sills are measured from the floor level (plinth top). */
function fitWindow(w, floor, floorH, plinthH) {
  const sill = w.sill + (floor === 0 ? plinthH : 0);
  const h = Math.min(w.h, floorH - sill - 0.12);
  return sill === w.sill && h === w.h ? w : { ...w, sill, h };
}

/** Timbers in a gable triangle: verges, king post, collar and braces (local frame, y from the wall top). */
function timberGable(tc, length, rise, d) {
  const out = {};
  const bs = (tc.beam ?? 0.2) * 0.9;
  const td = (tc.depth ?? 0.05) + 0.02;
  const z = td / 2 - 0.02;
  const cx = length / 2;
  const add = (g) => pushTo(out, 'timber', g);
  const top = rise - bs * 0.8;
  add(at(boxGeo(bs, top, td), cx, top / 2, z));
  const yc = rise * 0.45;
  const hw = cx * (1 - 0.45) - bs * 0.6;
  add(at(boxGeo(2 * hw, bs, td), cx, yc, z));
  if (d >= 1) {
    const k = bs / Math.cos(Math.atan2(rise, cx));
    add(beam([bs * 0.5, k * 0.5], [cx, rise - k * 0.5], bs, td, z));
    add(beam([length - bs * 0.5, k * 0.5], [cx, rise - k * 0.5], bs, td, z));
  }
  if (d >= 2) {
    add(beam([cx - hw * 0.8, bs], [cx - bs / 2, yc - bs / 2], bs * 0.8, td, z));
    add(beam([cx + hw * 0.8, bs], [cx + bs / 2, yc - bs / 2], bs * 0.8, td, z));
  }
  return out;
}

/** Turn a plan into geometry per material zone at one detail level (0 simple … 2 full). */
function assemble(p, d) {
  const { style } = p;
  const C = new Collector();
  const T = style.wallThickness;
  const plinthH = style.plinth?.height ?? 0;
  const plinthP = style.plinth?.projection ?? 0.06;
  const cache = new Map();
  const cached = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  const windowFor = (s) => windowSpec(style, s.floorRole);
  const byId = new Map(p.masses.map((m) => [m.id, m]));
  const slotsBy = new Map();
  for (const s of p.slots) {
    const key = `${s.mass}:${s.side}:${s.floor}`;
    if (!slotsBy.has(key)) slotsBy.set(key, []);
    slotsBy.get(key).push(s);
  }
  const roofs = new Map();
  for (const m of p.masses) {
    const { parts, info } = roofModule(m, d, eaveOut(style));
    roofs.set(m.id, info);
    C.addAll(parts, null);
  }
  for (const m of p.masses) {
    const info = roofs.get(m.id);
    const gableSides = m.roof.type === 'gable' ? (info.alongX ? ['left', 'right'] : ['front', 'back']) : [];
    for (const side of SIDE_NAMES) {
      const sd = m.sides[side];
      for (let f = 0; f < m.floors; f++) {
        const fl = sd.floors[f];
        const top = f === m.floors - 1;
        const gable = top && gableSides.includes(side);
        if (!fl.visible && !gable) continue;
        const r = massRect(m, f);
        const lvl = m.levels[f];
        const slots = slotsBy.get(`${m.id}:${side}:${f}`) || [];
        const along = side === 'front' || side === 'back';
        const len = fl.length - (along ? 0.004 : 0);
        const dr = doorFor(style, m.levels[0].h, plinthH);
        const openings = slots.map((s) => {
          if (s.role === 'door') return { x: s.u - fl.length / 2, y: 0, w: dr.w, h: plinthH + dr.h + (dr.fanlight ? dr.w / 2 : 0), shape: dr.fanlight || dr.shape === 'arch' ? 'arch' : 'rect' };
          const w = fitWindow(windowFor(s), f, lvl.h, plinthH);
          return { x: s.u - fl.length / 2, y: w.sill, w: w.w, h: w.h, shape: w.shape === 'arch' ? 'arch' : 'rect' };
        });
        const rise = gable ? Math.tan((m.roof.pitch * Math.PI) / 180) * (info.span / 2) - 0.08 : 0;
        const zone = style.floorZones?.[floorRole(m, f, style) === 'noble' ? 'upper' : floorRole(m, f, style)] || 'wall';
        // Lower floors reach 2 mm into the wall above, so stacked walls share no faces.
        const wg = archWall({ width: len, height: lvl.h + (top ? 0 : 0.002), thickness: T, openings, gableHeight: Math.max(0, rise) });
        at(wg, 0, 0, -T / 2);
        C.add(rise > 0 && zone !== 'wall' ? 'wall' : zone, wg, sideMatrix(side, r, fl.length / 2, lvl.y));
        // Openings.
        for (const s of slots) {
          const M = sideMatrix(side, r, s.u, lvl.y);
          if (s.role === 'door') C.addAll(cached(`door:${d}:${dr.h}`, () => doorModule(dr, d, T, plinthH, !style.portico)), M);
          else {
            const ws = fitWindow(windowFor(s), f, lvl.h, plinthH);
            C.addAll(cached(`win:${JSON.stringify(ws)}:${d}`, () => windowModule(ws, d, T)), M);
          }
        }
        if (rise > 0 && style.timber && style.timber.floors.includes(floorRole(m, f, style))) {
          C.addAll(timberGable(style.timber, fl.length, rise, d), sideMatrix(side, r, 0, lvl.y + lvl.h));
        }
        // Timber framing on timber floors.
        if (style.timber && style.timber.floors.includes(floorRole(m, f, style)) && fl.visible) {
          const sideInfo = { centers: sd.centers, bayWidth: sd.bayWidth, shift: fl.shift };
          C.addAll(timberModule(style.timber, fl.length, lvl.h, sideInfo, slots, (s) => fitWindow(windowFor(s), f, lvl.h, plinthH), d), sideMatrix(side, r, 0, lvl.y));
        }
      }
      // Plinth strip along the exposed ground floor (gap at the door).
      const fl0 = sd.floors[0];
      if (plinthH > 0 && fl0.visible) {
        const r0 = massRect(m, 0);
        const along = side === 'front' || side === 'back';
        const ext = along ? plinthP : 0;
        const doors = (slotsBy.get(`${m.id}:${side}:0`) || []).filter((s) => s.role === 'door');
        const cuts = [...fl0.hidden, ...doors.map((s) => [s.u - style.door.w / 2 - 0.02, s.u + style.door.w / 2 + 0.02])].sort((a, b) => a[0] - b[0]);
        let u = -ext;
        const segs = [];
        for (const [a, b] of cuts) {
          if (a > u + 0.05) segs.push([u, Math.min(a, fl0.length + ext)]);
          u = Math.max(u, b);
        }
        if (u < fl0.length + ext - 0.05) segs.push([u, fl0.length + ext]);
        const ph = plinthH - (along ? 0 : 0.003);
        for (const [a, b] of segs) {
          const g = at(boxGeo(b - a, ph, plinthP + 0.06), (a + b) / 2, ph / 2, (plinthP + 0.06) / 2 - 0.06);
          C.add('trim', g, sideMatrix(side, r0, 0, 0));
        }
      }
    }
    // String courses and cornice (rings around the mass).
    const bands = style.bands || {};
    if (bands.stringCourse?.length && d >= 1) {
      for (let f = 1; f < m.floors; f++) for (const g of ringBands(massRect(m, f), m.levels[f].y - 0.04, bands.stringCourse)) C.add('trim', g);
    }
    if (bands.cornice?.length) {
      const total = bands.cornice.reduce((s, [h]) => s + h, 0);
      const steps = d >= 1 ? bands.cornice : [[total, bands.cornice.at(-1)[1]]];
      for (const g of ringBands(massRect(m, m.floors - 1), m.height - total, steps)) C.add('trim', g);
    }
    // Quoins on exposed corners.
    if (style.quoins && d >= 1) addQuoins(C, m, p.masses, style, plinthH, bands);
    // Dormers.
    const dm = m.dormers === false ? null : style.dormers;
    if (dm && dm.pattern !== 'none' && ['gable', 'hip', 'mansard'].includes(m.roof.type)) {
      const info2 = roofs.get(m.id);
      const sides = info2.alongX ? ['front', 'back'] : ['left', 'right'];
      const top = m.floors - 1;
      for (const side of sides) {
        const sd = m.sides[side];
        const fl = sd.floors[top];
        const n = sd.bays;
        sd.centers.forEach((c, i) => {
          const center = Math.floor(n / 2);
          const pick = dm.pattern === 'all' || (dm.pattern === 'alternate' && i % 2 === center % 2) || (dm.pattern === 'center' && i === center);
          if (!pick) return;
          const u = c + fl.shift;
          // On a hip roof the hip line is as far from the end as it is from the eave (45° in plan).
          const hipInset = m.roof.type === 'hip' || m.roof.type === 'mansard' ? (dm.setback ?? 0.8) + (dm.depth ?? 1.8) + eaveOut(style) : 0;
          if (u - dm.w < hipInset + 0.3 || u + dm.w > fl.length - hipInset - 0.3) return;
          if (overlaps(fl.hidden, u - dm.w, u + dm.w)) return;
          C.addAll(cached(`dormer:${d}:${m.height}:${m.roof.type}:${m.roof.pitch}`, () => dormerModule(dm, m.height, m.roof, d, eaveOut(style))), sideMatrix(side, massRect(m, top), u, 0));
        });
      }
    }
    // Chimneys.
    const ch = m.chimneys === false || m.chimneys === 0 ? null : (typeof m.chimneys === 'object' ? deepMerge(style.chimneys || {}, m.chimneys) : style.chimneys);
    if (ch && ch.count > 0 && m.roof.type !== 'flat') addChimneys(C, m, roofs.get(m.id), ch, d, T);
  }
  // Portico at the entrance.
  if (style.portico) {
    const m = byId.get(p.entrance.mass);
    const sd = m.sides[p.entrance.side];
    if (sd.bays > 0) {
      const span = Math.min(sd.bays, style.portico.bays ?? 3);
      const width = span * sd.bayWidth;
      const door = p.slots.find((s) => s.role === 'door' && s.mass === m.id);
      const u = door ? door.u : sd.centers[Math.floor(sd.bays / 2)];
      const floors = Math.min(m.floors, style.portico.floors ?? 1);
      const height = m.levels[floors - 1].y + m.levels[floors - 1].h - (floors > 1 ? 0.3 : 0.2);
      C.addAll(porticoModule(style.portico, width, height, plinthH, d), sideMatrix(p.entrance.side, massRect(m, 0), u, 0));
    }
  }
  // Merge per zone, world-space tiling UVs.
  const zones = {};
  for (const [zone, list] of Object.entries(C.zones)) {
    const fin = finishFor(style, zone);
    zones[zone] = boxUV(merge(list), { scale: 1 / (fin.tile || 1.5) });
  }
  return zones;
}

function addQuoins(C, m, masses, style, plinthH, bands) {
  const q = style.quoins;
  const r = massRect(m, 0);
  const corniceH = (bands.cornice || []).reduce((s, [h]) => s + h, 0);
  const yEnd = m.height - corniceH;
  const corners = [
    { c: [r.x0, r.z1], a: [1, 0], na: [0, 1], b: [0, -1], nb: [-1, 0] },
    { c: [r.x1, r.z1], a: [-1, 0], na: [0, 1], b: [0, -1], nb: [1, 0] },
    { c: [r.x1, r.z0], a: [-1, 0], na: [0, -1], b: [0, 1], nb: [1, 0] },
    { c: [r.x0, r.z0], a: [1, 0], na: [0, -1], b: [0, 1], nb: [-1, 0] },
  ];
  for (const k of corners) {
    const px = k.c[0] + (k.na[0] + k.nb[0]) * 0.05;
    const pz = k.c[1] + (k.na[1] + k.nb[1]) * 0.05;
    const hidden = masses.some((B) => B !== m && B.height > plinthH + 1 && (() => {
      const br = massRect(B, 0);
      return px > br.x0 && px < br.x1 && pz > br.z0 && pz < br.z1;
    })());
    if (hidden) continue;
    let i = 0;
    for (let y = plinthH + 0.02; y + q.height <= yEnd + 1e-6; y += q.height, i++) {
      const la = i % 2 ? q.short : q.long;
      const lb = i % 2 ? q.long : q.short;
      const h = q.height - 0.03;
      // Block on face A (wraps the corner), block on face B.
      const ga = boxGeo(la + q.depth, h, q.depth + 0.05);
      const ca = [k.c[0] + k.a[0] * ((la - q.depth) / 2) + k.na[0] * ((q.depth - 0.05) / 2), k.c[1] + k.a[1] * ((la - q.depth) / 2) + k.na[1] * ((q.depth - 0.05) / 2)];
      if (k.a[0] === 0) ga.rotateY(Math.PI / 2);
      C.add('trim', at(ga, ca[0], y + h / 2, ca[1]));
      // Slightly shorter and shallower than block A, so no faces coincide where they meet.
      const qb = q.depth - 0.004;
      const gb = boxGeo(lb, h - 0.004, qb + 0.05);
      const cb = [k.c[0] + k.b[0] * (lb / 2) + k.nb[0] * ((qb - 0.05) / 2), k.c[1] + k.b[1] * (lb / 2) + k.nb[1] * ((qb - 0.05) / 2)];
      if (k.b[0] === 0) gb.rotateY(Math.PI / 2);
      C.add('trim', at(gb, cb[0], y + h / 2, cb[1]));
    }
  }
}

function addChimneys(C, m, info, ch, d, T) {
  const count = Math.max(1, Math.round(ch.count));
  const positions = [];
  const half = info.len / 2;
  const isHip = m.roof.type === 'hip' || m.roof.type === 'mansard';
  const endInset = isHip ? Math.max(ch.w, half - info.span / 2) : half - info.out - T / 2 - ch.w / 2 + 0.1;
  if (ch.placement === 'ends' || count <= 2) {
    const ends = count === 1 ? [endInset] : [-endInset, endInset];
    positions.push(...ends.slice(0, count));
  } else {
    for (let i = 0; i < count; i++) positions.push(-half * 0.7 + (1.4 * half * i) / (count - 1));
  }
  const yTop = info.ridgeY + (ch.above ?? 1);
  const y0 = m.height - 0.6;
  for (const pos of positions) {
    const cx = info.alongX ? info.cx + pos : info.cx;
    const cz = info.alongX ? info.cz : info.cz + pos;
    const w = info.alongX ? ch.w : ch.d;
    const dd = info.alongX ? ch.d : ch.w;
    C.add('chimney', at(boxGeo(w, yTop - y0, dd, { bevel: 0.02 }), cx, (y0 + yTop) / 2, cz));
    C.add('trim', at(boxGeo(w + 0.14, 0.16, dd + 0.14, { bevel: 0.02 }), cx, yTop + 0.08, cz));
    if (d >= 1) {
      const pots = Math.max(1, Math.round(Math.max(w, dd) / 0.42));
      for (let i = 0; i < pots; i++) {
        const t = pots === 1 ? 0 : -0.5 + i / (pots - 1);
        const px = info.alongX ? cx + t * (w - 0.3) : cx;
        const pz = info.alongX ? cz : cz + t * (dd - 0.3);
        C.add('roof', at(cylinder(0.1, 0.45, { radiusTop: 0.085, segments: d >= 2 ? 10 : 6, base: true }), px, yTop + 0.16, pz));
      }
    }
  }
}

const count = (zones) => Object.values(zones).reduce((s, g) => s + g.attributes.position.count / 3, 0);

/**
 * Geometry for a plan, fitted to a triangle budget by lowering the detail level.
 * @param {object} p from plan()
 * @param {{ detail?: 'auto'|0|1|2, budget?: number|null }} [opts]
 */
export function build(p, { detail = 'auto', budget = null } = {}) {
  const levels = detail === 'auto' ? [2, 1, 0] : [detail];
  let best = null;
  for (const d of levels) {
    const zones = assemble(p, d);
    best = { zones, detail: d, triangles: count(zones) };
    if (!budget || best.triangles <= budget) break;
  }
  const perZone = Object.fromEntries(Object.entries(best.zones).map(([z, g]) => [z, g.attributes.position.count / 3]));
  return {
    zones: best.zones,
    plan: p,
    stats: { triangles: best.triangles, detail: best.detail, perZone, slots: p.slots.length, budget, overBudget: !!budget && best.triangles > budget },
  };
}

// -------------------------------------------------------------------------------- materials

/** Resolve a zone's finish (following aliases like chimney: 'wall'). */
export function finishFor(style, zone, seen = new Set()) {
  const f = style.finishes?.[zone];
  if (typeof f === 'string') {
    if (seen.has(f)) throw new Error(`k.arch: finish alias loop at '${zone}'`);
    seen.add(zone);
    return finishFor(style, f, seen);
  }
  if (!f) {
    const fallback = { chimney: 'wall', shutter: 'door', timber: 'frame', metal: 'frame' }[zone];
    if (fallback && fallback !== zone) return finishFor(style, fallback, seen);
    return { kind: 'paint', color: '#888888' };
  }
  return f;
}

/** The zone a material comes from (aliases share one material). */
function materialKey(style, zone, seen = new Set()) {
  const f = style.finishes?.[zone];
  if (typeof f === 'string' && !seen.has(f)) {
    seen.add(zone);
    return materialKey(style, f, seen);
  }
  if (!f) {
    const fallback = { chimney: 'wall', shutter: 'door', timber: 'frame', metal: 'frame' }[zone];
    if (fallback && fallback !== zone && !seen.has(fallback)) {
      seen.add(zone);
      return materialKey(style, fallback, seen);
    }
  }
  return zone;
}

function shade(hex, amount) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
  return `#${c.getHexString()}`;
}

function finishMaterial(name, fin, size, seed) {
  const T = (suffix, opts = {}) => createTexture(size, size, { name: `${name}${suffix}`, seed, ...opts });
  const H = (suffix) => createTexture(size, size, { name: `${name}${suffix}`, seed, space: 'linear' });
  switch (fin.kind) {
    case 'brick':
    case 'ashlar':
    case 'rubble':
    case 'slate':
    case 'clay-tiles': {
      const cfg = {
        brick: { rows: 16, cols: 5, mortar: 0.022, vary: 0.16, offset: 0.5, rough: 0.86, strength: 2 },
        ashlar: { rows: 5, cols: 3, mortar: 0.012, vary: 0.06, offset: 0.5, rough: 0.8, strength: 1.2 },
        rubble: { rows: 7, cols: 4, mortar: 0.035, vary: 0.28, offset: 0.37, rough: 0.92, strength: 2.6 },
        slate: { rows: 11, cols: 4, mortar: 0.03, vary: 0.12, offset: 0.5, rough: 0.6, strength: 2.2 },
        'clay-tiles': { rows: 9, cols: 7, mortar: 0.035, vary: 0.2, offset: 0.5, rough: 0.78, strength: 2.2 },
      }[fin.kind];
      const mortar = fin.mortar || shade(fin.color, -0.18);
      const map = T('_color').fill(fin.color)
        .bricks({ rows: cfg.rows, cols: cfg.cols, mortar: cfg.mortar, mortarColor: mortar, vary: cfg.vary, offset: cfg.offset, jitterColor: shade(fin.color, -0.06) })
        .noise({ color: shade(fin.color, -0.12), scale: 8, amount: 0.22 });
      const h = H('_h').fill(0.75).bricks({ rows: cfg.rows, cols: cfg.cols, mortar: cfg.mortar, mortarColor: 0.15, vary: 0.3, offset: cfg.offset, seed: map.seed }).noise({ color: 0.5, scale: 10, amount: 0.25 }).blur(1);
      return pbr({ name, map, normalMap: normalFromHeight(h, { strength: cfg.strength }), roughness: cfg.rough });
    }
    case 'concrete': {
      const map = T('_color').fill(fin.color).bricks({ rows: 2, cols: 1, mortar: 0.006, mortarColor: shade(fin.color, -0.1), vary: 0.04, offset: 0 }).noise({ color: shade(fin.color, -0.07), scale: 9, amount: 0.25 });
      const h = H('_h').fill(0.6).noise({ color: 0.4, scale: 14, amount: 0.3 }).blur(1);
      return pbr({ name, map, normalMap: normalFromHeight(h, { strength: 0.6 }), roughness: 0.9 });
    }
    case 'plaster': {
      const map = T('_color').fill(fin.color).noise({ color: shade(fin.color, -0.08), scale: 5, amount: 0.25 }).noise({ color: shade(fin.color, 0.05), scale: 14, amount: 0.15 });
      const h = H('_h').fill(0.5).noise({ color: 0.3, scale: 12, amount: 0.4 }).blur(1);
      return pbr({ name, map, normalMap: normalFromHeight(h, { strength: 0.8 }), roughness: 0.92 });
    }
    case 'thatch': {
      const map = T('_color').fill(fin.color)
        .noise({ color: shade(fin.color, -0.25), scale: 4, stretch: [18, 1], amount: 0.85, contrast: 1.7 })
        .noise({ color: shade(fin.color, 0.15), scale: 6, stretch: [22, 1], amount: 0.45, mode: 'screen', contrast: 1.6 });
      return pbr({ name, map, roughness: 0.95 });
    }
    case 'zinc': {
      const map = T('_color').fill(fin.color).stripes({ count: 6, axis: 'u', width: 0.06, color: shade(fin.color, 0.12), alpha: 0.8, soft: 0.02 }).noise({ color: shade(fin.color, -0.06), scale: 6, amount: 0.2 });
      return pbr({ name, map, roughness: 0.45, metalness: 1 });
    }
    case 'timber': {
      const map = T('_color').fill(fin.color).grain({ color: shade(fin.color, -0.12), amount: 0.4, axis: 'u' });
      return pbr({ name, map, roughness: 0.82 });
    }
    case 'glass':
      return pbr({ name, color: fin.color, roughness: 0.08, metalness: 0 });
    case 'iron':
      return pbr({ name, color: fin.color, roughness: 0.55, metalness: 1 });
    case 'paint':
    default:
      return pbr({ name, color: fin.color, roughness: fin.roughness ?? 0.55, metalness: 0 });
  }
}

/**
 * One material per finish zone of a style. Zones that alias another zone share its material.
 * @returns {Record<string, THREE.Material>} zone → material (every zone in ZONES)
 */
export function materials(styleIn, { prefix = 'building', size = 512, finishes = null, zones = ZONES } = {}) {
  let style = resolveStyle(styleIn);
  if (finishes) style = deepMerge(style, { finishes });
  const made = {};
  const out = {};
  zones.forEach((zone) => {
    const key = materialKey(style, zone);
    if (!made[key]) made[key] = finishMaterial(`${prefix}_${key}`, finishFor(style, key), size, 400 + ZONES.indexOf(key));
    out[zone] = made[key];
  });
  return out;
}

/**
 * A whole building as a k.part: plan → build (budget) → materials, one mesh per material.
 * @param {object} spec plan spec + { name, budget, detail, texSize }
 */
export function building(spec = {}) {
  const name = spec.name || 'building';
  const p = plan(spec);
  const b = build(p, { detail: spec.detail ?? 'auto', budget: spec.budget ?? null });
  const mats = materials(p.style, { prefix: name, size: spec.texSize ?? 512, zones: Object.keys(b.zones) });
  const byMaterial = new Map();
  for (const [zone, g] of Object.entries(b.zones)) {
    const m = mats[zone];
    if (!byMaterial.has(m)) byMaterial.set(m, []);
    byMaterial.get(m).push(g);
  }
  const root = kPart(name);
  for (const [m, list] of byMaterial) root.add(kMesh(list.length > 1 ? merge(list) : list[0], m, { name: m.name }));
  return { part: root, plan: p, stats: b.stats, materials: mats };
}
