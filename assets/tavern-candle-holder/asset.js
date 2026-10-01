// Tavern Candle Holder — member of the 'tavern' set
import { defineAsset } from '../../studio/kit/index.js';
import style from '../../sets/tavern/style.js';

export default defineAsset({
  meta: {
    title: 'Tavern Candle Holder',
    prompt: 'Cozy fantasy tavern props: a trestle table, a stool, a wooden mug, a candle holder and a wall shelf',
    interpretation: 'Table candelabra, 0.38 m tall: weighted round iron foot, twisted stem, two curled arms and a center cup holding three wax candles of different heights with drips and glowing flames.',
    style: ['stylized', 'cozy', 'fantasy'],
    category: 'lighting',
    budget: { triangles: 3500 },
    set: 'tavern',
  },
  seed: 304,
  params: { armSpan: 0.13, candleHeights: [0.12, 0.09, 0.1], lit: true },
  variants: { unlit: { lit: false } },
  build({ p, k, rng }) {
    const m = style.materials(k);
    const asset = k.asset('candle_holder');
    const iron = k.part('iron');
    iron.add(k.mesh(k.geo.lathe([[0, 0], [0.075, 0], [0.078, 0.012], [0.05, 0.022], [0.016, 0.035], [0, 0.04]], { segments: 20 }), m.iron));
    iron.add(k.mesh(k.op.twist(k.geo.box(0.014, 0.16, 0.014, { base: true }), { angle: Math.PI * 2 }), m.iron, { at: [0, 0.035, 0] }));
    const cupY = 0.2;
    const cup = (x, y) => {
      iron.add(k.mesh(k.geo.lathe([[0, 0], [0.012, 0], [0.026, 0.015], [0.03, 0.022], [0.024, 0.022], [0, 0.012]], { segments: 14 }), m.iron, { at: [x, y, 0] }));
    };
    cup(0, cupY);
    for (const sx of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        pts.push([sx * t * p.armSpan, cupY - 0.03 - Math.sin(t * Math.PI) * 0.035 + t * 0.0, 0]);
      }
      iron.add(k.mesh(k.geo.tube(pts, 0.006, { segments: 20, radialSegments: 6 }), m.iron));
      // Little curl under each arm.
      const curl = [];
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 1.5;
        curl.push([sx * (0.04 + Math.sin(a) * 0.018), cupY - 0.06 - (1 - Math.cos(a)) * 0.018, 0]);
      }
      iron.add(k.mesh(k.geo.tube(curl, 0.004, { segments: 16, radialSegments: 5 }), m.iron));
      cup(sx * p.armSpan, cupY - 0.03);
    }
    const candles = k.part('candles');
    const cr = rng.stream('candles');
    const spots = [[0, cupY + 0.012], [-p.armSpan, cupY - 0.018], [p.armSpan, cupY - 0.018]];
    spots.forEach(([x, y], i) => {
      const h = p.candleHeights[i];
      candles.add(k.mesh(k.geo.cylinder(0.016, h, { segments: 12, bevel: 0.003, base: true }), m.wax, { at: [x, y, 0] }));
      for (let d = 0; d < 3; d++) {
        const a = cr.range(0, Math.PI * 2);
        const len = cr.range(0.015, 0.04);
        candles.add(k.mesh(k.geo.capsule(0.004, len, { capSegments: 3, radialSegments: 6 }), m.wax, { at: [x + Math.cos(a) * 0.016, y + h - len / 2 - 0.004, Math.sin(a) * 0.016] }));
      }
      candles.add(k.mesh(k.geo.cylinder(0.0015, 0.012, { segments: 4 }), m.woodDark, { at: [x, y + h + 0.004, 0] }));
      if (p.lit) {
        candles.add(k.mesh(k.geo.lathe([[0, 0], [0.007, 0.008], [0.006, 0.02], [0, 0.034]], { segments: 8 }), m.flame, { at: [x, y + h + 0.006, 0] }));
      }
    });
    asset.add(iron, candles);
    return asset;
  },
});
