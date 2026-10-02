// Fixture: a crate on the ground and a small cube hovering above it (not touching anything).
import { defineAsset } from '../../../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'fx floating', category: 'prop', origin: 'base-center' },
  build({ k }) {
    const a = k.asset('fx');
    const m = k.mat.pbr({ name: 'm' });
    a.add(k.mesh(k.geo.box(0.5, 0.5, 0.5, { base: true }), m, { name: 'crate' }));
    a.add(k.mesh(k.geo.box(0.1, 0.1, 0.1), m, { name: 'hover', at: [0, 0.9, 0] }));
    return a;
  },
});
