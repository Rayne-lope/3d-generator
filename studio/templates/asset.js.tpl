// {{TITLE}}
// Prompt: {{PROMPT}}
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: '{{TITLE}}',
    prompt: {{PROMPT_JSON}},
    interpretation: 'TODO: one or two sentences — style, real size, key features.',
    style: {{STYLE_JSON}},
    category: '{{CATEGORY}}',
    budget: { triangles: 5000 },{{SET_LINE}}
  },
  seed: {{SEED}},
  // Every proportion and count the user might want to change lives here.
  params: {
    width: 0.8,
    height: 0.6,
    depth: 0.5,
    bevel: 0.03,
  },
  // Named param overrides, each exported as its own GLB: <slug>--<variant>.glb
  variants: {},
  build({ p, k }) {
    const asset = k.asset('{{SLUG_NAME}}');
    const body = k.part('body');
    const mat = k.mat.physical('painted-wood', { color: '#b8443a' });
    body.add(k.mesh(k.geo.box(p.width, p.height, p.depth, { bevel: p.bevel, base: true }), mat));
    asset.add(body);
    return asset;
  },
});
