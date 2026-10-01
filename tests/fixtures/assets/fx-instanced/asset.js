// Fixture: an InstancedMesh with 3 instances (must be flattened).
import { defineAsset } from '../../../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'fx instanced', category: 'prop' },
  build({ k, THREE }) {
    const a = k.asset('fx');
    const im = new THREE.InstancedMesh(k.geo.box(0.2, 0.2, 0.2, { base: true }), k.mat.pbr({ name: 'm' }), 3);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) im.setMatrixAt(i, mtx.makeTranslation(i * 0.5, 0, 0));
    a.add(im);
    return a;
  },
});
