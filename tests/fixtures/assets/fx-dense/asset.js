// Fixture: one connected sphere with ~30k triangles (cannot be split by pieces).
import { defineAsset } from '../../../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'fx dense', category: 'prop' },
  build({ k }) {
    const a = k.asset('fx');
    a.add(k.mesh(k.geo.sphere(0.5, { widthSegments: 150, heightSegments: 102, base: true }), k.mat.pbr({ name: 'm' })));
    return a;
  },
});
