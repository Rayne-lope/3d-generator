// Fixture: a 30 × 3 × 30 m slab with a tiling texture repeating every 1.5 m (20 × 20 repeats):
// too many repeats to bake into one Roblox image without wrapping.
import { defineAsset } from '../../../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'fx big tiling', category: 'prop', origin: 'base-center' },
  build({ k }) {
    const a = k.asset('fx');
    const tex = k.tex.create(256, 256, { name: 'fx_bricks', seed: 3 }).fill('#9b4a35').bricks({ rows: 8, cols: 3, mortar: 0.03, mortarColor: '#ddd' });
    const m = k.mat.pbr({ name: 'bricks', map: tex });
    a.add(k.mesh(k.uv.box(k.geo.box(30, 3, 30, { base: true }), { scale: 1 / 1.5 }), m, { name: 'slab' }));
    return a;
  },
});
