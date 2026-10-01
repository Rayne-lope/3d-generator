// Tavern Table — member of the 'tavern' set
// Set prompt: "Cozy fantasy tavern props: a trestle table, a stool, a wooden mug, a candle holder and a wall shelf"
import { defineAsset } from '../../studio/kit/index.js';
import style from '../../sets/tavern/style.js';

export default defineAsset({
  meta: {
    title: 'Tavern Table',
    prompt: 'Cozy fantasy tavern props: a trestle table, a stool, a wooden mug, a candle holder and a wall shelf',
    interpretation: 'Trestle table 1.6 × 0.8 m at 0.76 m: a top of four chunky planks on two A-shaped trestles with wide feet, joined by a stretcher beam with protruding tenons and iron corner brackets.',
    style: ['stylized', 'cozy', 'fantasy'],
    category: 'furniture',
    budget: { triangles: 4000 },
    set: 'tavern',
  },
  seed: 301,
  params: { length: 1.6, width: 0.8, topPlanks: 4 },
  build({ p, k }) {
    const m = style.materials(k);
    const asset = k.asset('tavern_table');
    const H = style.dims.tableHeight;
    const T = style.dims.plank;
    const b = style.dims.bevel;
    const top = style.planks(k, m, { width: p.length, depth: p.width, count: p.topPlanks, seed: 11 });
    top.position.y = H;
    // Battens under the top.
    for (const x of [-p.length * 0.36, p.length * 0.36]) top.add(k.mesh(k.geo.box(0.08, 0.05, p.width - 0.08, { bevel: b }), m.woodDark, { at: [x, -T - 0.025, 0] }));
    const legs = k.part('trestles');
    const legH = H - T - 0.05;
    for (const x of [-p.length * 0.36, p.length * 0.36]) {
      for (const sz of [-1, 1]) {
        const leg = k.geo.box(0.07, legH + 0.06, 0.07, { bevel: b, base: true });
        legs.add(k.mesh(leg, m.woods[1], { at: [x, 0.04, sz * 0.08], rot: [sz * 0.32, 0, 0] }));
      }
      legs.add(k.mesh(k.geo.box(0.09, 0.07, p.width * 0.85, { bevel: b, base: true }), m.woodDark, { at: [x, 0, 0] })); // foot
    }
    // Stretcher with tenons poking through the legs.
    legs.add(k.mesh(k.geo.box(p.length * 0.72 + 0.16, 0.08, 0.06, { bevel: b }), m.woods[2], { at: [0, 0.32, 0] }));
    for (const sx of [-1, 1]) legs.add(k.mesh(k.geo.box(0.03, 0.05, 0.035, { bevel: 0.005 }), m.woodDark, { at: [sx * (p.length * 0.36 + 0.095), 0.32, 0] }));
    // Iron brackets where the top meets the battens.
    for (const x of [-p.length * 0.36, p.length * 0.36]) {
      for (const sz of [-1, 1]) legs.add(k.mesh(k.geo.box(0.1, 0.012, 0.05, { bevel: 0.003 }), m.iron, { at: [x, H - T - 0.008, sz * (p.width / 2 - 0.06)] }));
    }
    asset.add(top, legs);
    return asset;
  },
});
