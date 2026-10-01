// Tavern Stool — member of the 'tavern' set
import { defineAsset } from '../../studio/kit/index.js';
import style from '../../sets/tavern/style.js';

export default defineAsset({
  meta: {
    title: 'Tavern Stool',
    prompt: 'Cozy fantasy tavern props: a trestle table, a stool, a wooden mug, a candle holder and a wall shelf',
    interpretation: 'Three-legged stool, 0.45 m seat height: a thick round slab seat with a soft chamfer, splayed legs and a ring stretcher of three rungs.',
    style: ['stylized', 'cozy', 'fantasy'],
    category: 'furniture',
    budget: { triangles: 2500 },
    set: 'tavern',
  },
  seed: 302,
  params: { seatRadius: 0.19, legs: 3, splay: 0.16 },
  build({ p, k }) {
    const m = style.materials(k);
    const asset = k.asset('tavern_stool');
    const H = style.dims.seatHeight;
    const T = style.dims.plank * 1.1;
    const seat = k.part('seat');
    seat.add(k.mesh(k.geo.cylinder(p.seatRadius, T, { segments: 20, bevel: style.dims.bevel * 1.4, bevelSegments: 2 }), m.woods[0], { at: [0, H - T / 2, 0] }));
    const legs = k.part('legs');
    for (let i = 0; i < p.legs; i++) {
      const a = (i / p.legs) * Math.PI * 2;
      const r = p.seatRadius * 0.6;
      const leg = k.geo.cylinder(0.026, H - T + 0.02, { radiusTop: 0.022, segments: 8, base: true, bevel: 0.004 });
      const mesh = k.mesh(leg, m.woods[1], { at: [Math.cos(a) * (r + p.splay * 0.5 * (H - T)), 0, Math.sin(a) * (r + p.splay * 0.5 * (H - T))] });
      // Lean each leg inward toward the seat center.
      mesh.rotation.set(-Math.sin(a) * p.splay, 0, Math.cos(a) * p.splay, 'XZY');
      legs.add(mesh);
    }
    // Rungs between the legs.
    for (let i = 0; i < p.legs; i++) {
      const a0 = (i / p.legs) * Math.PI * 2;
      const a1 = ((i + 1) / p.legs) * Math.PI * 2;
      const r = p.seatRadius * 0.6 + p.splay * 0.5 * (H - T) - p.splay * 0.17;
      const pts = [[Math.cos(a0) * r, 0.17, Math.sin(a0) * r], [Math.cos(a1) * r, 0.17, Math.sin(a1) * r]];
      legs.add(k.mesh(k.geo.tube(pts, 0.012, { segments: 2, radialSegments: 6 }), m.woodDark));
    }
    asset.add(seat, legs);
    return asset;
  },
});
