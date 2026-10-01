// Fixture: a mesh mirrored with raw negative scale (bypassing k.mesh checks).
import { defineAsset } from '../../../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'fx negative scale', category: 'prop' },
  build({ k }) {
    const a = k.asset('fx');
    const m = k.mesh(k.geo.box(1, 0.5, 0.3, { base: true }), k.mat.pbr({ name: 'm' }));
    m.scale.x = -1;
    a.add(m);
    return a;
  },
});
