// AK-47 style assault rifle
// Prompt: AK-47 style assault rifle with a detachable curved magazine, then lots of skins on the same model: desert camo, woodland, tiger stripe, digital urban, arctic, neon and gold
import { defineAsset } from '../../studio/kit/index.js';

// Which surface zone each atlas entry belongs to. Skins pick a finish per zone.
const ZONE = {
  receiver: 'body', dustCover: 'body', controls: 'body', triggerGuard: 'body', buttPlate: 'body',
  barrel: 'barrel', muzzle: 'barrel', gasBlock: 'barrel', gasTube: 'barrel', frontSight: 'barrel',
  rearSight: 'barrel', cleaningRod: 'barrel', bands: 'barrel',
  stock: 'wood', grip: 'wood', upperGuard: 'wood', lowerGuard: 'wood',
  magazine: 'mag',
};

// Rivets on both receiver sides [x, y] (asset space, bore axis at y = 0, muzzle toward +X).
const RIVETS = [
  [0.040, -0.012], [0.054, -0.012], [0.040, -0.033], [0.054, -0.033], [0.047, -0.0225],
  [-0.041, -0.036], [-0.066, -0.036],
  [-0.186, -0.011], [-0.186, -0.034], [-0.196, -0.0225],
];
const DUST_COVER_RIBS = [-0.17, -0.135, -0.1, -0.065, -0.03, 0.005, 0.04];

export default defineAsset({
  meta: {
    title: 'AK-47 style assault rifle',
    prompt: 'AK-47 style assault rifle with a detachable curved magazine, then lots of skins on the same model: desert camo, woodland, tiger stripe, digital urban, arctic, neon and gold',
    interpretation: 'Realistic, game-ready AKM-style rifle, about 0.91 m long and 0.29 m tall with the 30-round magazine. It lies along X with the muzzle toward +X and its right side (ejection port, selector, charging handle) facing +Z, so the front view is the classic side profile. Parts: stamped receiver and dust cover, barrel with gas block, gas tube, sights and slant brake, walnut stock and handguards, bakelite grip and a curved magazine as a separate part pivoting at the magazine well. One material and one 1024 px atlas painted in 3D, so the default look and seven skins share the exact same mesh.',
    style: ['realistic', 'game-ready'],
    category: 'weapon',
    budget: { triangles: 9000 },
    origin: 'base-center',
  },
  seed: 47,
  params: {
    // Shape (variants may change these; skins may not).
    barrelLength: 0.35, // exposed barrel from the rear sight block to the muzzle device
    magCurve: 0.4, // radius of the magazine's back edge
    magLength: 0.21, // magazine length along its back edge
    // Surface (skins override only these).
    texSize: 1024,
    bodyFinish: 'metal', // receiver, dust cover, controls, trigger guard, butt plate: metal | coat | gold
    barrelFinish: 'metal', // barrel, gas block, sights, bands: metal | gold
    furniture: 'walnut', // stock and handguards: walnut | coat | gold
    gripFinish: 'bakelite', // pistol grip when the furniture is walnut: bakelite | walnut
    magFinish: 'bakelite', // magazine: bakelite | metal | coat | gold
    coat: null, // pattern for 'coat' finishes: camo | digital | tiger | hex
    coatColors: [],
    coatScale: 0.06, // camo blob size (m)
    coatCell: 0.008, // digital pixel / hex size (m)
    coatLine: 0.14, // hex line width (fraction of a cell)
    coatRough: 0.62,
    metal: '#4e535a', // blued steel (gunmetal)
    metalRough: 0.34,
    bare: '#a2a7ad', // steel showing through worn edges
    wood: ['#7a4524', '#3b1d0d'], // walnut light / dark grain
    woodWorn: '#a77548',
    bakelite: '#6e2c1a',
    gold: '#e3b04a',
    goldAlt: '#b9852c',
    goldEdge: '#fff0b8',
    wear: 0.5,
    grime: 0.5,
    patternSeed: 7,
    normalStrength: 1.6,
  },
  // Skins: same mesh, different surface. Each one is checked against the default look.
  skins: {
    desert: { bodyFinish: 'coat', furniture: 'coat', magFinish: 'coat', coat: 'camo', coatColors: ['#c9b287', '#a08159', '#73603f', '#e4d6b6'], coatScale: 0.06 },
    woodland: { bodyFinish: 'coat', furniture: 'coat', magFinish: 'coat', coat: 'camo', coatColors: ['#6e7748', '#45392a', '#1f201b', '#9c9165'], coatScale: 0.055 },
    tiger: { bodyFinish: 'coat', furniture: 'coat', magFinish: 'coat', coat: 'tiger', coatColors: ['#9c9767', '#5d6a3b', '#1b1c16'] },
    digital: { bodyFinish: 'coat', furniture: 'coat', magFinish: 'coat', coat: 'digital', coatColors: ['#a3a7ac', '#73777b', '#46494d', '#d2d5d8'], coatCell: 0.0075 },
    arctic: { bodyFinish: 'coat', furniture: 'coat', magFinish: 'coat', coat: 'camo', coatColors: ['#eef1f4', '#cdd4da', '#98a3ad'], coatScale: 0.07, grime: 0.3 },
    neon: { furniture: 'coat', magFinish: 'coat', coat: 'hex', coatColors: ['#121216', '#19e3ff', '#ff2fd5'], coatCell: 0.009, coatLine: 0.09, coatRough: 0.3, wear: 0.15 },
    gold: { bodyFinish: 'gold', barrelFinish: 'gold', furniture: 'gold', magFinish: 'gold', wear: 0.45, grime: 0.6 },
  },
  build({ p, k }) {
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const smooth = (a, b, v) => {
      const t = clamp01((v - a) / (b - a));
      return t * t * (3 - 2 * t);
    };
    const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
    const T = (g, x, y, z = 0) => k.op.translate(g, x, y, z);
    // Side profile drawn in XY (x along the rifle, y up), extruded across Z (centered).
    const profile = (pts, depth, bevel) => k.geo.extrude(k.shape.polygon(pts), depth, { axis: 'z', bevel, bevelSegments: 2 });
    // Cross-section drawn in ZY, extruded along X (centered at x = 0).
    const section = (shape, length, bevel) => k.geo.extrude(shape, length, { axis: 'x', bevel, bevelSegments: 2 });
    const cylX = (r, len, x0, y, opts = {}) => T(k.op.lieAlong(k.geo.cylinder(r, len, { segments: 20, ...opts }), 'x'), x0 + len / 2, y);

    // ------------------------------------------------------------- primary forms
    const receiver = T(k.geo.box(0.27, 0.058, 0.0335, { bevel: 0.0025 }), -0.07, -0.017);
    const dcPts = [];
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * Math.PI;
      const c = Math.cos(t);
      dcPts.push([0.0158 * Math.sign(c) * Math.abs(c) ** 0.7, 0.0205 * Math.sin(t) ** 0.55]);
    }
    const dustCover = T(section(k.shape.polygon(dcPts), 0.254, 0.0012), -0.069, 0.0112);
    const muzzleX = 0.065 + p.barrelLength;
    const barrel = cylX(0.0092, muzzleX - 0.06, 0.06, 0);
    // Outline points must not be collinear: the cap triangulation would get zero-area triangles.
    const stock = profile([
      [-0.198, 0.004], [-0.26, -0.003], [-0.34, -0.0125], [-0.432, -0.026], [-0.432, -0.143], [-0.4, -0.13],
      [-0.36, -0.112], [-0.31, -0.09], [-0.26, -0.07], [-0.226, -0.0565], [-0.198, -0.044],
    ], 0.026, 0.005);
    const grip = profile([
      [-0.068, -0.04], [-0.106, -0.04], [-0.114, -0.064], [-0.126, -0.1], [-0.138, -0.142], [-0.104, -0.15],
      [-0.096, -0.122], [-0.088, -0.094], [-0.08, -0.07], [-0.073, -0.055],
    ], 0.022, 0.004);
    // Curved magazine: back and front edges are arcs around one center.
    const Rb = p.magCurve;
    const Rf = Rb - 0.052;
    const Cx = Rb;
    const Cy = -0.03;
    const sweep = p.magLength / Rb;
    const magPts = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (i / 10) * sweep;
      magPts.push([Cx + Rb * Math.cos(a), Cy + Rb * Math.sin(a)]);
    }
    for (let i = 10; i >= 0; i--) {
      const a = Math.PI + (i / 10) * sweep;
      magPts.push([Cx + Rf * Math.cos(a), Cy + Rf * Math.sin(a)]);
    }
    const magBody = profile(magPts, 0.02, 0.003);
    const endA = Math.PI + sweep;
    const bb = [Cx + Rb * Math.cos(endA), Cy + Rb * Math.sin(endA)];
    const bf = [Cx + Rf * Math.cos(endA), Cy + Rf * Math.sin(endA)];
    const out = [-Math.sin(endA), Math.cos(endA)];
    const floorPlate = T(k.op.rotate(k.geo.box(0.064, 0.006, 0.029, { bevel: 0.0012 }), 0, 0, Math.atan2(bf[1] - bb[1], bf[0] - bb[0])), (bb[0] + bf[0]) / 2 + out[0] * 0.002, (bb[1] + bf[1]) / 2 + out[1] * 0.002);

    // ------------------------------------------------------------- secondary forms
    const rearSight = k.op.merge(
      T(k.geo.box(0.052, 0.035, 0.03, { bevel: 0.002 }), 0.091, 0.0055),
      T(k.geo.box(0.046, 0.005, 0.013, { bevel: 0.0008 }), 0.089, 0.0255),
      T(k.geo.box(0.005, 0.009, 0.016, { bevel: 0.0008 }), 0.11, 0.0295),
    );
    const muzzle = cylX(0.0115, 0.036, muzzleX, 0, { bevel: 0.0025, radiusTop: 0.0105 });
    const gbX = muzzleX - 0.115;
    const gasBlock = k.op.merge(
      cylX(0.0135, 0.032, gbX, 0, { bevel: 0.0015 }),
      T(k.geo.box(0.03, 0.022, 0.018, { bevel: 0.002 }), gbX + 0.016, 0.012),
      cylX(0.0098, 0.02, gbX + 0.006, 0.0225, { segments: 16, bevel: 0.0015 }),
    );
    const gasTube = cylX(0.0086, gbX - 0.11, 0.11, 0.0225, { segments: 16 });
    // Lower handguard starts at the receiver; the upper one at the rear sight block.
    const upperGuard = T(section(k.shape.rect(0.027, 0.024, { radius: 0.0105, segments: 4 }), 0.124, 0.002), 0.181, 0.0225);
    const lowerSection = k.shape.polygon([
      [0.017, 0.008], [0.0205, 0], [0.022, -0.014], [0.019, -0.027], [0.012, -0.034],
      [-0.012, -0.034], [-0.019, -0.027], [-0.022, -0.014], [-0.0205, 0], [-0.017, 0.008],
    ]);
    const lowerGuard = T(k.op.bulge(section(lowerSection, 0.176, 0.002), { axis: 'x', amount: 0.05 }), 0.158, 0);
    const bands = k.op.merge(
      T(k.geo.box(0.01, 0.054, 0.05, { bevel: 0.0015 }), 0.251, -0.0075),
      T(k.geo.box(0.006, 0.03, 0.031, { bevel: 0.001 }), 0.2475, 0.0225),
    );
    const fsX = muzzleX - 0.03;
    const frontSight = k.op.merge(
      T(k.geo.box(0.026, 0.026, 0.024, { bevel: 0.002 }), fsX, -0.002),
      T(k.geo.box(0.014, 0.032, 0.0028, { bevel: 0.0006 }), fsX, 0.025, 0.0085),
      T(k.geo.box(0.014, 0.032, 0.0028, { bevel: 0.0006 }), fsX, 0.025, -0.0085),
      T(k.geo.cylinder(0.0014, 0.026, { segments: 8 }), fsX, 0.024),
      T(k.geo.box(0.016, 0.008, 0.009, { bevel: 0.001 }), fsX - 0.004, -0.019),
    );
    const cleaningRod = k.op.merge(cylX(0.0028, fsX - 0.296, 0.284, -0.019, { segments: 10 }), cylX(0.0042, 0.008, fsX - 0.022, -0.019, { segments: 10, bevel: 0.001 }));
    const buttPlate = T(k.geo.box(0.006, 0.128, 0.037, { bevel: 0.0015 }), -0.44, -0.0845);
    const guard = k.shape.withHoles(
      k.shape.polygon([[-0.084, -0.04], [-0.084, -0.062], [-0.077, -0.074], [-0.062, -0.079], [-0.014, -0.079], [-0.004, -0.07], [-0.004, -0.04]]),
      k.shape.polygon([[-0.078, -0.048], [-0.078, -0.061], [-0.072, -0.0705], [-0.061, -0.0745], [-0.016, -0.0745], [-0.01, -0.068], [-0.01, -0.048]]),
    );
    const triggerGuard = k.op.merge(
      k.geo.extrude(guard, 0.009, { axis: 'z', bevel: 0.0008, bevelSegments: 1 }),
      profile([[-0.05, -0.044], [-0.042, -0.044], [-0.044, -0.058], [-0.05, -0.068], [-0.056, -0.069], [-0.053, -0.06]], 0.004, 0.0006),
    );
    // Right-side controls: selector lever (with finger tab) and charging handle.
    const zSide = 0.01675;
    const controls = k.op.merge(
      T(profile([[-0.098, -0.004], [-0.098, -0.016], [-0.086, -0.018], [-0.074, -0.011], [0.026, 0.004], [0.034, 0.01], [0.026, 0.012], [-0.08, -0.001]], 0.0016, 0.0004), 0, 0, zSide + 0.0012),
      T(k.geo.box(0.01, 0.004, 0.006, { bevel: 0.0008 }), 0.03, 0.008, zSide + 0.003),
      T(k.op.rotate(k.geo.cylinder(0.0038, 0.022, { segments: 12 }), Math.PI / 2, 0, 0), 0.044, 0.004, zSide + 0.011),
      T(k.op.scale(k.geo.sphere(0.0058, { widthSegments: 12, heightSegments: 8 }), 1, 0.85, 0.75), 0.044, 0.004, zSide + 0.022),
    );

    // ------------------------------------------------------------- one atlas for everything
    const raw = { receiver, dustCover, rearSight, barrel, muzzle, gasBlock, gasTube, upperGuard, lowerGuard, bands, frontSight, cleaningRod, stock, buttPlate, grip, triggerGuard, controls, magazine: k.op.merge(magBody, floorPlate) };
    const U = {};
    for (const [name, g] of Object.entries(raw)) U[name] = k.uv.unwrap(g);
    const S = p.texSize;
    k.uv.atlas(U, { size: S, padding: 12 });
    const bake = k.bake.surface(U).edges({ angle: 25, width: 0.0035 }).ao({ distance: 0.03, samples: 16, size: 192 });

    // ------------------------------------------------------------- tertiary: painted in 3D
    const C = (hex) => k.color.srgb(hex);
    const metalC = C(p.metal);
    const bareC = C(p.bare);
    const portC = C('#141516');
    const woodLight = C(p.wood[0]);
    const woodDark = C(p.wood[1]);
    const woodWorn = C(p.woodWorn);
    const bakeliteC = C(p.bakelite);
    const goldEdge = C(p.goldEdge);
    const goldBody = k.tex.pattern.brushed({ color: p.gold, axis: [1, 0, 0], amount: 0.07, scale: 0.0012, seed: 11 });
    const goldAlt = k.tex.pattern.brushed({ color: p.goldAlt, axis: [1, -0.2, 0], amount: 0.05, scale: 0.0016, seed: 12 });
    const coat = p.coat === 'camo' ? k.tex.pattern.camo({ colors: p.coatColors, scale: p.coatScale, seed: p.patternSeed })
      : p.coat === 'digital' ? k.tex.pattern.digital({ colors: p.coatColors, cell: p.coatCell, scale: p.coatScale, seed: p.patternSeed })
        : p.coat === 'tiger' ? k.tex.pattern.tiger({ colors: p.coatColors, seed: p.patternSeed })
          : p.coat === 'hex' ? k.tex.pattern.hex({ colors: p.coatColors, size: p.coatCell, line: p.coatLine, seed: p.patternSeed })
            : null;
    // Fixed seeds: wear and grain sit in the same places in every skin.
    const wearN = k.noise(4747);
    const chipN = k.noise(4748);
    const grainN = k.noise(1947);
    const varN = k.noise(747);
    // Grain axis per wooden piece: origin and direction of the tree's growth rings.
    const norm = (v) => {
      const l = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    const grainAxis = (o, d) => {
      const n = norm(d);
      return { o, d: n, e1: norm([-n[1], n[0], 0]) };
    };
    const GRAIN = {
      stock: grainAxis([-0.32, -0.05, 0.03], [-0.234, -0.07, 0]),
      grip: grainAxis([-0.1, -0.095, 0.02], [-0.032, -0.11, 0]),
      upperGuard: grainAxis([0.18, 0.03, 0.02], [1, 0, 0]),
      lowerGuard: grainAxis([0.16, -0.015, 0.03], [1, 0, 0]),
    };
    const gripPerp = norm([0.108, -0.028, 0]);

    // Height detail shared by every skin (so the normal map is identical across skins).
    const detailHeight = (t) => {
      const [x, y, z] = t.pos;
      const nz = Math.abs(t.normal[2]);
      let h = 0.5;
      if (t.entry === 'receiver' && nz > 0.7) {
        for (const [rx, ry] of RIVETS) {
          const d = Math.hypot(x - rx, y - ry);
          if (d < 0.0024) h += 0.35 * Math.sqrt(1 - (d / 0.0024) ** 2);
        }
        if (z > 0 && x > -0.032 && x < 0.036 && y > -0.004 && y < 0.01) h -= 0.3;
        // AKM magazine-guide dimple above the magazine well (both sides).
        const dd = Math.hypot((x - 0.026) / 0.009, (y + 0.03) / 0.0055);
        if (dd < 1) h -= 0.22 * (1 - dd * dd);
      } else if (t.entry === 'dustCover') {
        for (const rx of DUST_COVER_RIBS) {
          const d = Math.abs(x - rx);
          if (d < 0.002) h += 0.12 * (1 - d / 0.002);
        }
      } else if (t.entry === 'magazine' && nz > 0.6) {
        const r = Math.hypot(x - Cx, y - Cy);
        for (const rr of [Rb - 0.009, Rf + 0.009]) {
          const d = Math.abs(r - rr);
          if (d < 0.0022) h += 0.3 * (1 - d / 0.0022);
        }
      } else if (t.entry === 'grip' && nz > 0.6) {
        const s = (x * gripPerp[0] + y * gripPerp[1]) / 0.0036;
        const f = s - Math.floor(s);
        h -= 0.2 * smooth(0.3, 0.5, f) * (1 - smooth(0.5, 0.7, f));
      }
      return h;
    };

    // Walnut: long streaks along the grain, faint growth rings, broad figure.
    const walnut = (t, wear) => {
      const g = GRAIN[t.entry] || GRAIN.stock;
      const vx = t.pos[0] - g.o[0];
      const vy = t.pos[1] - g.o[1];
      const vz = t.pos[2] - g.o[2];
      const along = vx * g.d[0] + vy * g.d[1] + vz * g.d[2];
      const u = vx * g.e1[0] + vy * g.e1[1];
      const figure = grainN.fbm3(t.pos[0] * 9, t.pos[1] * 9, t.pos[2] * 9, { octaves: 2 });
      const streak = grainN.fbm3(along * 7, u * 300, vz * 300, { octaves: 2 });
      const ring = Math.hypot(u, vz) / 0.008 + figure * 1.6;
      const band = 0.5 + 0.5 * Math.sin(ring * Math.PI * 2);
      const c = mix3(woodLight, woodDark, clamp01(0.42 + streak * 0.5 + (band - 0.5) * 0.25 + figure * 0.25));
      return mix3(c, woodWorn, wear * 0.7);
    };

    const N = S * S;
    const col = new Float32Array(N * 3);
    const rough = new Float32Array(N);
    const metalness = new Float32Array(N);
    const height = new Float32Array(N);
    bake.forEach((t) => {
      const [x, y, z] = t.pos;
      const zone = ZONE[t.entry];
      let fin;
      if (zone === 'wood') fin = t.entry === 'grip' && p.furniture === 'walnut' ? p.gripFinish : p.furniture;
      else if (zone === 'mag') fin = p.magFinish;
      else if (zone === 'body') fin = p.bodyFinish;
      else fin = p.barrelFinish;
      if (t.entry === 'receiver' && z > 0 && t.normal[2] > 0.7 && x > -0.032 && x < 0.036 && y > -0.004 && y < 0.01) fin = 'port';
      const wn = wearN.fbm3(x * 70, y * 70, z * 70, { octaves: 3 }) * 0.5 + 0.5;
      const wear = smooth(0.45, 0.8, t.edge * (0.45 + wn) * (0.4 + p.wear));
      const chip = smooth(0.74, 0.8, chipN.fbm3(x * 150, y * 150, z * 150, { octaves: 2 }) * 0.5 + 0.5) * smooth(0.2, 0.9, p.wear);
      const large = varN.fbm3(x * 12, y * 12, z * 12, { octaves: 2 });
      let c;
      let r;
      let m;
      if (fin === 'metal') {
        const tone = zone === 'barrel' ? 0.85 : 1;
        c = mix3(mul3(metalC, tone * (1 + large * 0.08)), bareC, wear);
        r = p.metalRough + (zone === 'barrel' ? 0.08 : 0) + large * 0.06 - wear * 0.12;
        m = 1;
      } else if (fin === 'walnut') {
        c = walnut(t, wear);
        r = 0.5 + large * 0.05;
        m = 0;
      } else if (fin === 'bakelite') {
        c = mix3(mul3(bakeliteC, 1 + large * 0.12), C('#9a4a32'), wear * 0.6);
        r = 0.42 + large * 0.05 + wear * 0.1;
        m = 0;
      } else if (fin === 'coat' && coat) {
        // Paint over metal (worn edges show steel) or over wood (worn edges show walnut).
        const under = zone === 'wood' ? walnut(t, 0) : bareC;
        const reveal = clamp01(wear + chip * 0.8);
        c = mix3(mul3(coat(t), 1 + large * 0.05), under, reveal);
        r = p.coatRough * (1 - reveal) + (zone === 'wood' ? 0.5 : 0.35) * reveal + large * 0.04;
        m = zone === 'wood' ? 0 : reveal;
      } else if (fin === 'gold') {
        c = mix3(zone === 'wood' ? goldAlt(t) : goldBody(t), goldEdge, wear * 0.8);
        r = (zone === 'wood' ? 0.24 : 0.13) + large * 0.04 - wear * 0.05;
        m = 1;
      } else {
        c = portC;
        r = 0.45;
        m = 1;
      }
      const grime = t.cavity * p.grime;
      const dark = (1 - grime * 0.45) * (1 - (1 - t.ao) * 0.6);
      const i = t.i;
      col[i * 3] = c[0] * dark;
      col[i * 3 + 1] = c[1] * dark;
      col[i * 3 + 2] = c[2] * dark;
      rough[i] = Math.min(1, Math.max(0.08, r + grime * 0.15));
      metalness[i] = m;
      height[i] = detailHeight(t);
    });
    const colorTex = k.tex.create(S, S, { layout: 'atlas', name: 'ak-color' }).fill(p.metal);
    colorTex.paint3d(bake, (t) => [col[t.i * 3], col[t.i * 3 + 1], col[t.i * 3 + 2]]);
    const ormTex = k.tex.create(S, S, { space: 'linear', layout: 'atlas', name: 'ak-orm' }).fill([1, 0.5, 1]);
    ormTex.paint3d(bake, (t) => [1, rough[t.i], metalness[t.i]]);
    const heightTex = k.tex.create(S, S, { space: 'linear', layout: 'atlas', name: 'ak-height' }).fill(0.5);
    heightTex.paint3d(bake, (t) => [height[t.i], height[t.i], height[t.i]]);
    const normalTex = k.tex.normalFromHeight(heightTex, { strength: p.normalStrength, name: 'ak-normal' });
    const rifle = k.mat.pbr({ name: 'rifle', map: colorTex, ormMap: ormTex, normalMap: normalTex, roughness: 1, metalness: 1 });

    // ------------------------------------------------------------- structure
    const asset = k.asset('ak_rifle');
    const groups = {
      receiver: ['receiver', 'dustCover', 'controls', 'triggerGuard'],
      barrel: ['barrel', 'muzzle', 'gasBlock', 'gasTube', 'frontSight', 'rearSight', 'cleaningRod', 'bands'],
      furniture: ['stock', 'buttPlate', 'grip', 'upperGuard', 'lowerGuard'],
    };
    for (const [name, list] of Object.entries(groups)) {
      const part = k.part(name);
      for (const e of list) part.add(k.mesh(U[e], rifle, { name: e }));
      asset.add(part);
    }
    // The magazine detaches in-engine: its node pivots at the front lug of the magazine well.
    const mag = k.part('magazine', { separate: true, pivot: [0.05, -0.046, 0] });
    mag.add(k.mesh(U.magazine, rifle, { name: 'magazine' }));
    asset.add(mag);
    return asset;
  },
});
