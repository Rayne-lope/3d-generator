// Fixture: a 1 m crate face with a 2304 px (non power of two) repeating texture.
import { defineAsset } from '../../../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'fx big texture', category: 'prop' },
  build({ k }) {
    const a = k.asset('fx');
    const tex = k.tex.create(2304, 2304).fill('#a0522d').checker({ count: 16, color: '#5a2d0c' });
    a.add(k.mesh(k.uv.box(k.geo.box(1, 1, 1, { base: true }), { scale: 1 }), k.mat.pbr({ name: 'big', map: tex })));
    return a;
  },
});
