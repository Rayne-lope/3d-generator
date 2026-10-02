import { defineAsset } from '../../../../studio/kit/index.js';
import base from '../fx-skins/asset.js';

// The skins fixture without its broken skins: what a publishable asset looks like.
export default defineAsset({
  meta: { ...base.meta, title: 'Skins Test OK' },
  seed: base.seed,
  params: base.params,
  skins: { paint: base.skins.paint },
  build: base.build,
});
