// Stylized Wooden Barrel
// Prompt: "A stylized wooden barrel with chunky iron hoops, slightly bulging, cartoon proportions"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Stylized Wooden Barrel',
    prompt: 'A stylized wooden barrel with chunky iron hoops, slightly bulging, cartoon proportions',
    interpretation: 'Chunky 1 m barrel with a pronounced belly, 14 separate staves with visible grooves, four thick dark-iron hoops with big rivets, recessed plank lid. Flat colors, no textures (stylized).',
    style: ['stylized', 'cartoon'],
    category: 'container',
    budget: { triangles: 6000 },
  },
  seed: 4211,
  params: {
    height: 1.0,
    radiusEnd: 0.33, // radius at top and bottom
    bulge: 0.2, // extra radius at the belly, as a fraction of radiusEnd
    staves: 14,
    staveGap: 0.012, // groove width between staves (radians)
    staveThickness: 0.035,
    hoopYs: [0.07, 0.3, 0.7, 0.93], // hoop centers as a fraction of height
    hoopHeight: 0.055,
    hoopThickness: 0.018,
    rivetsPerHoop: 6,
    rivetRadius: 0.016,
    lidInset: 0.035,
    woodColors: ['#b8763c', '#a86a35', '#c4824a'],
    grooveColor: '#4a2a14',
    ironColor: '#565c66', // painted (non-metal) iron reads the same in every engine
    brokenStaves: [], // stave indices that are snapped short
    hoopDropped: false, // top hoop slipped down and tilted
    lid: true,
  },
  variants: {
    small: { height: 0.72, radiusEnd: 0.25, staves: 12, rivetsPerHoop: 5 },
    broken: { brokenStaves: [2, 3, 9], hoopDropped: true, lid: false, seed: 977 },
  },
  build({ p, k, rng }) {
    const asset = k.asset('stylized_barrel');
    const H = p.height;
    // Radius along the height: smooth parabolic belly.
    const radiusAt = (y) => {
      const t = y / H;
      return p.radiusEnd * (1 + p.bulge * (1 - (2 * t - 1) ** 2));
    };
    const woods = p.woodColors.map((c, i) => k.mat.pbr({ name: `wood_${i + 1}`, color: c, roughness: 0.78 }));
    const groove = k.mat.pbr({ name: 'groove', color: p.grooveColor, roughness: 0.85 });
    // Stylized "painted metal": metalness 0 keeps the hoops readable without an environment map.
    const iron = k.mat.pbr({ name: 'iron', color: p.ironColor, roughness: 0.45, metalness: 0 });

    // Core: a slightly smaller solid that shows through the stave grooves.
    const coreProfile = [];
    const rings = 8;
    // The core stops below the lid (or forms the visible inside when the lid is missing).
    const coreTop = p.lid ? H - p.lidInset - 0.03 : H * 0.55;
    coreProfile.push([0, 0.004]);
    for (let i = 0; i <= rings; i++) {
      const y = 0.004 + (i / rings) * (coreTop - 0.004);
      coreProfile.push([radiusAt(y) - p.staveThickness * 0.6, y]);
    }
    coreProfile.push([0, coreTop]);
    const body = k.part('body');
    body.add(k.mesh(k.geo.lathe(coreProfile, { segments: p.staves * 2, crease: 50 }), groove, { name: 'core' }));

    // Staves: closed curved slabs following the belly.
    const staves = k.part('staves');
    const step = (Math.PI * 2) / p.staves;
    const staveRng = rng.stream('staves');
    for (let i = 0; i < p.staves; i++) {
      const broken = p.brokenStaves.includes(i);
      const top = broken ? H * staveRng.range(0.55, 0.8) : H;
      const prof = [];
      for (let s = 0; s <= rings; s++) {
        const y = (s / rings) * top;
        prof.push([radiusAt(y), y]);
      }
      for (let s = rings; s >= 0; s--) {
        const y = (s / rings) * top;
        prof.push([radiusAt(y) - p.staveThickness, y]);
      }
      const jitter = staveRng.jitter(0.004);
      const g = k.geo.lathe(prof.map(([r, y]) => [r + jitter, y]), {
        closed: true,
        phiStart: i * step + p.staveGap / 2,
        phiLength: step - p.staveGap,
        segments: 3,
        crease: 35,
      });
      staves.add(k.mesh(g, woods[staveRng.int(0, woods.length - 1)], { name: `stave_${i}` }));
    }

    // Lid: recessed disc with plank grooves.
    if (p.lid) {
      const lid = k.part('lid');
      const lidY = H - p.lidInset;
      const lidR = radiusAt(lidY) - p.staveThickness * 0.9;
      lid.add(k.mesh(k.geo.cylinder(lidR, 0.03, { segments: p.staves * 2, bevel: 0.006 }), woods[0], { at: [0, lidY - 0.015, 0], name: 'lid' }));
      for (const x of [-lidR / 3, lidR / 3]) {
        const len = 2 * Math.sqrt(Math.max(0, lidR * lidR - x * x)) - 0.01;
        lid.add(k.mesh(k.geo.box(0.008, 0.006, len), groove, { at: [x, lidY + 0.0005, 0], name: 'lid_groove' }));
      }
      asset.add(lid);
    }

    // Hoops: conform to the belly at their height; chunky with big rivets.
    const hoops = k.part('hoops');
    const hoopRng = rng.stream('hoops');
    p.hoopYs.forEach((f, hi) => {
      const dropped = p.hoopDropped && hi === p.hoopYs.length - 1;
      const yc = (dropped ? f - 0.12 : f) * H;
      const y0 = yc - p.hoopHeight / 2;
      const y1 = yc + p.hoopHeight / 2;
      const r0 = radiusAt(y0) - 0.002;
      const r1 = radiusAt(y1) - 0.002;
      const t = p.hoopThickness;
      // Profile relative to the hoop center so a dropped hoop tilts around itself.
      const prof = [[r0, y0], [r0 + t, y0], [r0 + t + 0.003, y0 + p.hoopHeight * 0.25], [r1 + t + 0.003, y1 - p.hoopHeight * 0.25], [r1 + t, y1], [r1, y1]].map(([r, y]) => [r, y - yc]);
      const ring = k.group(`hoop_${hi}`);
      ring.position.y = yc;
      ring.add(k.mesh(k.geo.lathe(prof, { closed: true, segments: 32, crease: 40 }), iron, { name: `hoop_${hi}` }));
      for (let r = 0; r < p.rivetsPerHoop; r++) {
        const a = (r / p.rivetsPerHoop) * Math.PI * 2 + hoopRng.range(0, 0.2);
        const rr = (r0 + r1) / 2 + t + 0.002;
        ring.add(k.mesh(k.geo.icosphere(p.rivetRadius, 0), iron, { at: [Math.sin(a) * rr, 0, Math.cos(a) * rr], name: 'rivet' }));
      }
      if (dropped) {
        ring.rotation.set(hoopRng.range(0.08, 0.12), 0, hoopRng.range(-0.05, 0.05));
      }
      hoops.add(ring);
    });

    asset.add(body, staves, hoops);
    return asset;
  },
});
