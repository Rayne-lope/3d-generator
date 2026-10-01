// {{TITLE}} — member of the '{{SET}}' set
// Set prompt: {{PROMPT}}
import { defineAsset } from '../../studio/kit/index.js';
import style from '../../sets/{{SET}}/style.js';

export default defineAsset({
  meta: {
    title: '{{TITLE}}',
    prompt: {{PROMPT_JSON}},
    interpretation: 'TODO: how this member reads within the set (size, role, key features).',
    style: {{STYLE_JSON}},
    category: '{{CATEGORY}}',
    budget: { triangles: 4000 },
    set: '{{SET}}',
  },
  seed: {{SEED}},
  params: {
    width: 0.5,
    height: 0.5,
    depth: 0.5,
  },
  variants: {},
  build({ p, k }) {
    const m = style.materials(k);
    const asset = k.asset('{{SLUG_NAME}}');
    asset.add(k.mesh(k.geo.box(p.width, p.height, p.depth, { bevel: style.dims.bevel, base: true }), m.primary));
    return asset;
  },
});
