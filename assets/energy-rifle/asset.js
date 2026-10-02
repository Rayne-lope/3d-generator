// Futuristic energy rifle (modeled after reference.png)
// Prompt: Futuristic sci-fi energy rifle like the reference image: layered armor plates with chamfered corners, skeleton stock, glowing blue energy cell and barrel, scope and forked muzzle
import { defineAsset } from '../../studio/kit/index.js';

// How this asset was traced: every outline below is written in pixel coordinates read from
// reference.png (1400×700, side view; review the gridded image and the reference overlay).
// px(x, y) turns them into meters: the subject spans x 25 → 1375 px = p.length, and the bore
// axis sits at y = 330 px. Depths (Z thickness) are in meters.

// Which atlas zone each piece belongs to (skins pick a finish per zone).
const ZONES = { plates: 'plates', body: 'body', polymer: 'polymer' };

export default defineAsset({
  meta: {
    title: 'Futuristic energy rifle',
    prompt: 'Futuristic sci-fi energy rifle like the reference image: layered armor plates with chamfered corners, skeleton stock, glowing blue energy cell and barrel, scope and forked muzzle',
    interpretation: 'Hard-surface sci-fi rifle, 1.0 m long and about 0.27 m tall, traced from reference.png (side view = the front view here: muzzle toward +X, the visible side facing +Z). Layered light-metal armor plates with 45° chamfers over a gunmetal body, black polymer skeleton stock and ergonomic grip, glowing energy cell between two clamp rings (a separate part that can be ejected), glowing barrel core under a plated shroud, scope with a light window, top rail and a forked muzzle cage. One 3D-painted atlas material plus one glow material, so skins only recolor.',
    style: ['sci-fi', 'hard-surface', 'game-ready'],
    category: 'weapon',
    budget: { triangles: 14000 },
    origin: 'base-center',
    reference: { image: 'reference.png', view: 'front' },
  },
  seed: 2077,
  params: {
    length: 1.0, // overall length (m); every traced outline scales with it
    chamferPx: 7, // default 45° chamfer of the armor plates, in reference pixels
    texSize: 1024,
    // Surface (skins override only these)
    plate: '#c4c9cf', // light armor plates
    plateMetal: 1,
    plateRough: 0.42,
    body: '#50555c', // gunmetal frame
    bodyRough: 0.45,
    polymer: '#1c1e22', // black stock, grip, butt
    edgeLight: 0.55, // brighter worn edges
    glow: '#2fb2ff',
    glowStrength: 1,
    pattern: null, // optional pattern on the plates: 'hex' | 'digital' | 'camo'
    patternColors: [],
    wear: 0.45,
  },
  skins: {
    crimson: { plate: '#8a1d24', plateMetal: 0, plateRough: 0.32, body: '#2a2c30', polymer: '#141416', glow: '#ff3b30' },
    arctic: { plate: '#e8ecf0', plateMetal: 0, plateRough: 0.42, body: '#8d959e', polymer: '#cfd5da', glow: '#36f2ff', edgeLight: 0.3 },
    gold: { plate: '#e3ae4a', plateMetal: 1, plateRough: 0.2, body: '#1f2124', polymer: '#111214', glow: '#ffb03b', edgeLight: 0.7 },
    'hex-ops': { plate: '#2d3238', plateMetal: 0, plateRough: 0.5, pattern: 'hex', patternColors: ['#2d3238', '#57e6ff', '#57e6ff'], body: '#1a1c1f', glow: '#57e6ff', edgeLight: 0.4 },
  },
  build({ p, k }) {
    const S = p.length / 1350;
    const px = (x, y) => [(x - 25) * S, (330 - y) * S];
    const pts = (list) => list.map(([x, y, s, style]) => [...px(x, y), s === undefined ? undefined : s * S, style]);
    const chamfer = p.chamferPx * S;
    const T = (g, x = 0, y = 0, z = 0) => k.op.translate(g, x, y, z);
    // A side plate: chamfered outline traced in px, extruded `depth` m across Z, light edge bevel.
    const plate = (list, depth, { size = chamfer, bevel = 0.0012, z = 0, holes = [] } = {}) => {
      let shape = k.shape.chamfered(pts(list), { size });
      if (holes.length) shape = k.shape.withHoles(shape, ...holes.map((h) => k.shape.chamfered(pts(h), { size })));
      return T(k.geo.extrude(shape, Math.max(0.001, depth - 2 * bevel), { axis: 'z', bevel, bevelSegments: 1 }), 0, 0, z);
    };
    // A glow inlay: a band along a traced path, slightly deeper than the part it sits in, so
    // it shows 1 mm proud on both faces.
    const inlay = (path, widthPx, depth) => k.geo.extrude(k.shape.polyline(pts(path), { width: widthPx * S, size: 4 * S }), depth + 0.002, { axis: 'z' });
    const cylX = (r, x0px, x1px, ypx = 330, opts = {}) => {
      const [x0] = px(x0px, 0);
      const [x1] = px(x1px, 0);
      return T(k.op.lieAlong(k.geo.cylinder(r, x1 - x0, { segments: 24, ...opts }), 'x'), (x0 + x1) / 2, px(0, ypx)[1]);
    };
    const octaRing = (r, x0px, x1px) => {
      const [x0] = px(x0px, 0);
      const [x1] = px(x1px, 0);
      const g = k.op.lieAlong(k.geo.prism(8, r, x1 - x0, { bevel: 0.002 }), 'x');
      return T(k.op.rotate(g, Math.PI / 8, 0, 0), (x0 + x1) / 2, 0);
    };

    // ------------------------------------------------------------- stock and grip (polymer)
    // Skeleton stock: upper bar + diagonal brace around a traced opening; the grip closes it.
    const stockFrame = plate([
      [100, 295], [300, 295], [318, 330], [320, 372], [300, 430], [275, 500], [270, 540], [245, 540], [118, 446], [100, 440],
    ], 0.032, { holes: [[[165, 366], [302, 366], [318, 385], [314, 400], [290, 437], [264, 474], [252, 476], [163, 405]]] });
    const butt = plate([[25, 272, 12], [112, 262, 10], [118, 470, 10], [30, 478, 12]], 0.046);
    const grip = k.geo.extrude(k.shape.spline(pts([
      [300, 365], [358, 372], [360, 440], [342, 495], [336, 535], [322, 546], [300, 540], [278, 505], [268, 480], [290, 440], [318, 398], [318, 380],
    ]), { segments: 48 }), 0.03, { axis: 'z', bevel: 0.003, bevelSegments: 2 });
    const guard = plate([[370, 376], [460, 376], [460, 420, 8], [446, 434], [384, 434, 8], [370, 420]], 0.011, { holes: [[[382, 381], [449, 381], [449, 418], [438, 425], [395, 425], [382, 418]]], size: 4 * S });
    const trigger = k.geo.extrude(k.shape.polyline(pts([[398, 376], [406, 398], [396, 418]]), { width: 5 * S, corner: 'fillet', size: 10 * S }), 0.005, { axis: 'z' });

    // ------------------------------------------------------------- receiver (gunmetal body)
    // Two blueprint views: the side outline and the top outline (it widens toward the front).
    const receiver = k.geo.dualProfile({
      side: k.shape.chamfered(pts([[290, 278], [330, 262], [642, 262], [656, 280], [656, 370], [642, 384], [300, 384], [290, 374]]), { size: chamfer }),
      top: k.shape.polygon([[px(290, 0)[0], -0.021], [px(656, 0)[0], -0.025], [px(656, 0)[0], 0.025], [px(290, 0)[0], 0.021]]),
    });
    const lowerBlock = plate([[500, 376], [652, 376], [656, 396], [642, 412], [500, 412]], 0.044);
    const housing = plate([[500, 412], [680, 412], [684, 430, 6], [650, 482, 12], [535, 482, 12], [500, 455, 10]], 0.042);
    const housingFrame = k.geo.extrude(k.shape.withHoles(
      k.shape.chamfered(pts([[500, 412], [680, 412], [684, 430, 6], [650, 482, 12], [535, 482, 12], [500, 455, 10]]), { size: chamfer }),
      k.shape.offset(k.shape.chamfered(pts([[500, 412], [680, 412], [684, 430, 6], [650, 482, 12], [535, 482, 12], [500, 455, 10]]), { size: chamfer }), -9 * S),
    ), 0.048, { axis: 'z', bevel: 0.001, bevelSegments: 1 });
    const rail = k.op.merge(
      plate([[598, 240], [826, 240], [826, 252], [598, 252]], 0.022, { size: 2 * S }),
      ...Array.from({ length: 16 }, (_, i) => plate([[604 + i * 14, 234], [612 + i * 14, 234], [612 + i * 14, 241], [604 + i * 14, 241]], 0.02, { size: 1.5 * S, bevel: 0.0006 })),
    );
    const scope = k.op.merge(
      plate([[386, 190], [590, 190], [603, 203], [600, 232], [586, 242], [386, 242]], 0.03),
      plate([[345, 202], [358, 189], [392, 189], [392, 244], [358, 244], [345, 232]], 0.036),
      plate([[402, 241], [436, 241], [436, 254], [402, 254]], 0.016, { size: 2 * S }),
      plate([[560, 241], [588, 241], [588, 254], [560, 254]], 0.016, { size: 2 * S }),
    );
    const shroud = k.op.merge(
      plate([[866, 266], [880, 256], [930, 256], [950, 247, 4], [1328, 247, 3], [1318, 258], [1228, 262], [1228, 288], [866, 288]], 0.044),
      plate([[862, 388], [935, 348], [1222, 348], [1228, 398, 6], [1200, 412], [870, 412]], 0.046),
      plate([[1105, 405], [1328, 405, 3], [1318, 418], [1110, 418]], 0.02, { size: 3 * S }),
      plate([[865, 415], [970, 415], [972, 428], [960, 438], [875, 438], [865, 428]], 0.03),
    );
    const lowerBeam = plate([[600, 395], [880, 395], [905, 404], [905, 416], [880, 424], [690, 424], [675, 416], [600, 416]], 0.03);
    const connector = k.op.merge(
      cylX(0.026, 860, 1020),
      ...[905, 930, 955, 980].map((x) => cylX(0.033, x, x + 7, 330, { bevel: 0.001 })),
      cylX(0.03, 1010, 1030),
    );
    const muzzleHousing = T(k.geo.loft([
      { at: 0, shape: k.shape.chamfered([[-0.048, -0.048], [0.048, -0.048], [0.048, 0.048], [-0.048, 0.048]], { size: 0.02 }) },
      { at: 30 * S, shape: k.shape.chamfered([[-0.048, -0.048], [0.048, -0.048], [0.048, 0.048], [-0.048, 0.048]], { size: 0.02 }) },
      { at: 44 * S, shape: k.shape.chamfered([[-0.04, -0.044], [0.04, -0.044], [0.04, 0.044], [-0.04, 0.044]], { size: 0.016 }) },
    ], { samples: 32 }), px(1215, 0)[0], px(0, 333)[1]);
    const prongs = k.op.merge(
      plate([[1255, 281], [1362, 285, 6], [1376, 296, 6], [1372, 306], [1255, 307]], 0.032),
      plate([[1255, 356], [1372, 357], [1376, 367, 6], [1362, 380, 6], [1255, 382]], 0.032),
      ...[-1, 1].map((sgn) => T(plate([[1255, 318], [1370, 322], [1370, 342], [1255, 346]], 0.012, { size: 4 * S }), 0, 0, sgn * 0.036)),
      plate([[1350, 300], [1372, 304], [1372, 361], [1350, 365]], 0.05, { size: 4 * S }),
    );
    // Curved conduit under the energy cell (a sweep along a 3D path).
    const conduit = k.geo.sweep(k.shape.circle(4 * S, 10), [
      [...px(652, 394), 0.019], [...px(760, 404), 0.027], [...px(868, 394), 0.019],
    ], { segments: 32 });

    // ------------------------------------------------------------- armor plates (light metal)
    const plates = k.op.merge(
      plate([[105, 266], [255, 262], [268, 272], [262, 300], [110, 305]], 0.04),
      plate([[378, 262], [390, 250], [826, 250, 8], [838, 262], [830, 274], [480, 274], [470, 296, 6], [390, 296], [376, 286]], 0.058),
      plate([[462, 300], [528, 300], [628, 410], [565, 410]], 0.06),
      plate([[998, 265], [1158, 265], [1132, 315], [1028, 315]], 0.054),
      plate([[990, 251, 4], [1215, 251], [1232, 262, 6], [1222, 274], [1000, 274]], 0.05),
      plate([[945, 385], [975, 345], [1150, 345], [1162, 385]], 0.054),
      plate([[850, 415], [948, 346], [976, 346], [880, 415]], 0.05, { size: 4 * S }),
      plate([[40, 300], [60, 288], [100, 288], [104, 440], [60, 448], [40, 436]], 0.05, { size: 6 * S }),
    );

    // ------------------------------------------------------------- energy cell (separate part)
    const cellBody = k.op.merge(
      octaRing(0.047, 645, 676),
      octaRing(0.047, 820, 866),
      plate([[674, 280], [822, 280], [822, 290], [674, 290]], 0.03, { size: 2 * S }),
      plate([[674, 370], [822, 370], [822, 380], [674, 380]], 0.03, { size: 2 * S }),
    );

    // ------------------------------------------------------------- glow (emissive material)
    const glowGeo = k.op.merge(
      cylX(0.03, 672, 824),
      cylX(0.0105, 1015, 1222, 328),
      cylX(0.028, 915, 921),
      cylX(0.028, 962, 968),
      cylX(0.02, 1252, 1352, 332),
      plate([[1140, 296], [1218, 296], [1218, 305], [1140, 305]], 0.03, { size: 2 * S, bevel: 0 }),
      plate([[1150, 356], [1218, 356], [1218, 365], [1150, 365]], 0.03, { size: 2 * S, bevel: 0 }),
      T(inlay([[168, 346], [255, 346], [268, 330]], 7, 0.032), 0, 0, 0),
      T(inlay([[134, 392], [134, 430]], 6, 0.032), 0, 0, 0),
      T(inlay([[348, 455], [334, 492]], 6, 0.03), 0, 0, 0),
      T(inlay([[405, 322], [470, 322]], 7, 0.058), 0, 0, 0),
      T(inlay([[567, 418], [572, 426], [630, 426]], 6, 0.042), 0, 0, 0),
      T(inlay([[452, 210], [540, 210]], 8, 0.032), 0, 0, 0),
    );

    // ------------------------------------------------------------- one atlas, painted in 3D
    const raw = {
      plates,
      body: k.op.merge(receiver, lowerBlock, housing, housingFrame, rail, scope, shroud, lowerBeam, connector, muzzleHousing, prongs, guard, trigger, conduit),
      polymer: k.op.merge(stockFrame, butt, grip),
      cell: cellBody,
    };
    const U = {};
    for (const [name, g] of Object.entries(raw)) U[name] = k.uv.unwrap(g);
    const TS = p.texSize;
    k.uv.atlas(U, { size: TS, padding: 12 });
    const bake = k.bake.surface(U).edges({ angle: 30, width: 0.0025 }).ao({ distance: 0.03, samples: 16, size: 192 });
    const C = (hex) => k.color.srgb(hex);
    const zoneColor = { plates: C(p.plate), body: C(p.body), cell: C(p.body), polymer: C(p.polymer) };
    const brushed = k.tex.pattern.brushed({ color: p.plate, axis: [1, 0, 0], amount: 0.06, scale: 0.0012, seed: 3 });
    const pattern = p.pattern === 'hex' ? k.tex.pattern.hex({ colors: p.patternColors, size: 0.009, line: 0.08, accent: 0.06, seed: 5 })
      : p.pattern === 'digital' ? k.tex.pattern.digital({ colors: p.patternColors, cell: 0.008, seed: 5 })
        : p.pattern === 'camo' ? k.tex.pattern.camo({ colors: p.patternColors, scale: 0.06, seed: 5 })
          : null;
    const wearN = k.noise(91);
    const varN = k.noise(92);
    const N = TS * TS;
    const col = new Float32Array(N * 3);
    const rough = new Float32Array(N);
    const metal = new Float32Array(N);
    const height = new Float32Array(N).fill(0.5);
    bake.forEach((t) => {
      const [x, y, z] = t.pos;
      const zone = ZONES[t.entry] || 'body';
      const large = varN.fbm3(x * 14, y * 14, z * 14, { octaves: 2 });
      let c = zone === 'plates' ? (pattern ? pattern(t) : p.plateMetal ? brushed(t) : zoneColor.plates) : zoneColor[t.entry] || zoneColor.body;
      c = [c[0] * (1 + large * 0.05), c[1] * (1 + large * 0.05), c[2] * (1 + large * 0.05)];
      const wn = wearN.fbm3(x * 80, y * 80, z * 80, { octaves: 2 }) * 0.5 + 0.5;
      const edge = Math.min(1, t.edge * (0.5 + wn) * (0.5 + p.wear));
      const lift = edge * p.edgeLight;
      c = [c[0] + (1 - c[0]) * lift * 0.6, c[1] + (1 - c[1]) * lift * 0.6, c[2] + (1 - c[2]) * lift * 0.6];
      const shade = (1 - t.cavity * 0.4) * (1 - (1 - t.ao) * 0.55);
      const i = t.i;
      col[i * 3] = c[0] * shade;
      col[i * 3 + 1] = c[1] * shade;
      col[i * 3 + 2] = c[2] * shade;
      if (zone === 'plates') {
        metal[i] = p.plateMetal;
        rough[i] = p.plateRough + large * 0.04 - edge * 0.08;
      } else if (zone === 'polymer') {
        metal[i] = 0;
        rough[i] = 0.62 + large * 0.05;
      } else {
        metal[i] = 1;
        rough[i] = p.bodyRough + large * 0.05 - edge * 0.1;
      }
      // Shared surface detail (same in every skin): vents on the butt, seams on the body.
      let h = 0.5;
      if (t.entry === 'polymer' && Math.abs(t.normal[2]) > 0.7 && x < px(112, 0)[0] && x > px(40, 0)[0]) {
        const vy = (y - px(0, 300)[1]) / (14 * S);
        if (vy < 0 && vy > -9 && (vy - Math.floor(vy)) < 0.35) h -= 0.25;
      }
      if (t.entry === 'body' && Math.abs(t.normal[2]) > 0.7) {
        for (const sx of [px(372, 0)[0], px(560, 0)[0], px(1100, 0)[0]]) if (Math.abs(x - sx) < 0.0008) h -= 0.3;
      }
      height[i] = h;
    });
    const colorTex = k.tex.create(TS, TS, { layout: 'atlas', name: 'rifle-color' }).fill(p.body);
    colorTex.paint3d(bake, (t) => [col[t.i * 3], col[t.i * 3 + 1], col[t.i * 3 + 2]]);
    const ormTex = k.tex.create(TS, TS, { space: 'linear', layout: 'atlas', name: 'rifle-orm' }).fill([1, 0.5, 1]);
    ormTex.paint3d(bake, (t) => [1, Math.min(1, Math.max(0.08, rough[t.i])), metal[t.i]]);
    const heightTex = k.tex.create(TS, TS, { space: 'linear', layout: 'atlas', name: 'rifle-height' }).fill(0.5);
    heightTex.paint3d(bake, (t) => [height[t.i], height[t.i], height[t.i]]);
    const normalTex = k.tex.normalFromHeight(heightTex, { strength: 1.5, name: 'rifle-normal' });
    const armor = k.mat.pbr({ name: 'armor', map: colorTex, ormMap: ormTex, normalMap: normalTex, roughness: 1, metalness: 1 });
    const glow = k.mat.pbr({ name: 'glow', color: k.color.shade(p.glow, -0.2), emissive: p.glow, emissiveIntensity: p.glowStrength, roughness: 0.3 });

    // ------------------------------------------------------------- structure
    const asset = k.asset('energy_rifle');
    const frame = k.part('frame');
    frame.add(k.mesh(U.plates, armor, { name: 'plates' }));
    frame.add(k.mesh(U.body, armor, { name: 'body' }));
    frame.add(k.mesh(U.polymer, armor, { name: 'stock' }));
    frame.add(k.mesh(glowGeo, glow, { name: 'glow' }));
    asset.add(frame);
    // The energy cell ejects forward: its node pivots at the rear clamp.
    const cell = k.part('cell', { separate: true, pivot: [...px(645, 330), 0] });
    cell.add(k.mesh(U.cell, armor, { name: 'cell' }));
    asset.add(cell);
    return asset;
  },
});
