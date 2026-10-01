// AI 3D Asset Studio kit. Asset modules import only this file:
//   import { defineAsset } from '../../studio/kit/index.js';
// and receive everything else through build({ p, k, rng, noise, THREE }).

export { defineAsset } from './define.js';
export { runAsset, applyOrigin } from './runtime.js';
export { k, KIT_VERSION } from './k.js';
