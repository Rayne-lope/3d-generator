// Fixture: meta.collision shortcuts.
import { defineAsset } from '../../../../studio/kit/index.js';

export default defineAsset({
  meta: { title: 'Bounds fixture', category: 'prop', collision: 'bounds' },
  build({ k }) {
    const asset = k.asset('fx_bounds');
    asset.add(k.mesh(k.geo.box(0.4, 0.8, 0.2), k.mat.pbr({ name: 'gray', color: '#888888' }), { at: [0, 0.4, 0] }));
    return asset;
  },
});
