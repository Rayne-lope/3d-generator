// Tavern Mug — member of the 'tavern' set
import { defineAsset } from '../../studio/kit/index.js';
import style from '../../sets/tavern/style.js';

export default defineAsset({
  meta: {
    title: 'Tavern Mug',
    prompt: 'Cozy fantasy tavern props: a trestle table, a stool, a wooden mug, a candle holder and a wall shelf',
    interpretation: 'Stave-built wooden tankard, 0.17 m tall: slightly tapered staves with grooves, two iron bands, a chunky D-shaped handle and a domed head of ale foam spilling over the rim.',
    style: ['stylized', 'cozy', 'fantasy'],
    category: 'decor',
    budget: { triangles: 2500 },
    set: 'tavern',
  },
  seed: 303,
  params: { height: 0.17, radius: 0.06, staves: 10, foam: true },
  variants: { empty: { foam: false } },
  build({ p, k, rng }) {
    const m = style.materials(k);
    const asset = k.asset('tavern_mug');
    const H = p.height;
    const R = p.radius;
    const rAt = (y) => R * (1.06 - 0.12 * (y / H));
    const body = k.part('body');
    // Core and floor.
    body.add(k.mesh(k.geo.lathe([[0, 0.003], [rAt(0) - 0.006, 0.003], [rAt(H) - 0.006, H - 0.012], [rAt(H) - 0.014, H - 0.012], [rAt(0) - 0.014, 0.012], [0, 0.012]], { segments: 20 }), m.woodDark));
    const step = (Math.PI * 2) / p.staves;
    const sr = rng.stream('staves');
    for (let i = 0; i < p.staves; i++) {
      const prof = [[rAt(0), 0], [rAt(H), H], [rAt(H) - 0.008, H], [rAt(0) - 0.008, 0]];
      const g = k.geo.lathe(prof, { closed: true, phiStart: i * step + 0.02, phiLength: step - 0.04, segments: 2 });
      body.add(k.mesh(g, m.woods[sr.int(0, 2)]));
    }
    for (const f of [0.18, 0.78]) {
      const y = H * f;
      body.add(k.mesh(k.geo.lathe([[rAt(y - 0.008) - 0.001, y - 0.008], [rAt(y - 0.008) + 0.004, y - 0.008], [rAt(y + 0.008) + 0.004, y + 0.008], [rAt(y + 0.008) - 0.001, y + 0.008]], { closed: true, segments: 24 }), m.iron));
    }
    // Handle: D-shaped tube on the +X side.
    const handle = k.part('handle');
    const hx = rAt(H / 2) - 0.002;
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const a = -Math.PI / 2 + t * Math.PI;
      pts.push([hx + Math.cos(a) * 0.045, H * 0.5 + Math.sin(a) * H * 0.33, 0]);
    }
    handle.add(k.mesh(k.geo.tube(pts, 0.011, { segments: 16, radialSegments: 8 }), m.woods[1]));
    asset.add(body, handle);
    if (p.foam) {
      const foam = k.part('foam');
      foam.add(k.mesh(k.op.noise(k.geo.sphere(rAt(H) * 1.02, { widthSegments: 18, heightSegments: 8, hemisphere: true }), { amount: 0.004, scale: 60, seed: 5 }), m.ale, { at: [0, H - 0.014, 0], scale: [1, 0.55, 1] }));
      asset.add(foam);
    }
    return asset;
  },
});
