// Fixture: a box whose triangle winding was flipped without fixing normals.
import { defineAsset } from '../../../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'fx inverted', category: 'prop' },
  build({ k }) {
    const a = k.asset('fx');
    a.add(k.mesh(k.op.flipWinding(k.geo.box(1, 1, 1, { base: true })), k.mat.pbr({ name: 'm' })));
    return a;
  },
});
