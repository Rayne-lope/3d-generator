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
  // Curate controls for the member; shared palette/materials remain in the set style.
  editor: {
    version: 1,
    groups: [{ id: 'shape', label: 'Shape' }],
    controls: [
      { key: 'width', type: 'number', label: 'Width', group: 'shape', min: 0.1, max: 5, step: 0.01, unit: 'm', displayUnit: 'cm' },
      { key: 'height', type: 'number', label: 'Height', group: 'shape', min: 0.1, max: 5, step: 0.01, unit: 'm', displayUnit: 'cm' },
      { key: 'depth', type: 'number', label: 'Depth', group: 'shape', min: 0.1, max: 5, step: 0.01, unit: 'm', displayUnit: 'cm' },
    ],
    parts: [],
  },
  variants: {},
  build({ p, k }) {
    const m = style.materials(k);
    const asset = k.asset('{{SLUG_NAME}}');
    const body = k.part('body', { id: 'body' });
    body.add(k.mesh(k.geo.box(p.width, p.height, p.depth, { bevel: style.dims.bevel, base: true }), m.primary));
    asset.add(body);
    return asset;
  },
});
