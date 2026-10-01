// Fixture: a 20 m slab with one 256 px non-repeating texture stretched over it (~13 px/m).
import { defineAsset } from '../../../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'fx low density', category: 'environment' },
  build({ k }) {
    const a = k.asset('fx');
    let g = k.geo.box(20, 0.2, 20, { base: true });
    g = k.uv.fit(k.uv.planar(g, { axis: 'y' }));
    const tex = k.tex.create(256, 256, { layout: 'atlas' }).fill('#556b2f').noise({ color: '#2f4f2f', scale: 6 });
    a.add(k.mesh(g, k.mat.pbr({ name: 'ground', map: tex })));
    return a;
  },
});
