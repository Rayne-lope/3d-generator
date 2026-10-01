// Fixture: three separate ~10k-triangle spheres in one mesh (splittable by pieces).
import { defineAsset } from '../../../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'fx split', category: 'prop' },
  build({ k }) {
    const a = k.asset('fx');
    const m = k.mat.pbr({ name: 'm' });
    for (let i = 0; i < 3; i++) a.add(k.mesh(k.geo.sphere(0.3, { widthSegments: 90, heightSegments: 58, base: true }), m, { at: [i * 0.8, 0, 0] }));
    return a;
  },
});
