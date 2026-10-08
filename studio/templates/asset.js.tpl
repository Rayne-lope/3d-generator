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
    // reference: { image: 'reference.png', view: 'front' }, // a side-view picture to match (rules/17)
  },
  seed: {{SEED}},
  // Every proportion and count the user might want to change lives here.
  params: {
    width: 0.8,
    height: 0.6,
    depth: 0.5,
    bevel: 0.03,
    color: '#b8443a',
  },
  // Keep this curated schema in sync when replacing the placeholder with the requested asset.
  // Seed and internal detail/texture settings stay source-owned.
  editor: {
    version: 1,
    groups: [{ id: 'shape', label: 'Shape' }, { id: 'surface', label: 'Surface' }],
    controls: [
      { key: 'width', type: 'number', label: 'Width', group: 'shape', min: 0.1, max: 5, step: 0.01, unit: 'm', displayUnit: 'cm' },
      { key: 'height', type: 'number', label: 'Height', group: 'shape', min: 0.1, max: 5, step: 0.01, unit: 'm', displayUnit: 'cm' },
      { key: 'depth', type: 'number', label: 'Depth', group: 'shape', min: 0.1, max: 5, step: 0.01, unit: 'm', displayUnit: 'cm' },
      { key: 'bevel', type: 'number', label: 'Edge bevel', group: 'shape', min: 0, max: 0.04, step: 0.001, unit: 'm', displayUnit: 'cm' },
      { key: 'color', type: 'color', label: 'Paint color', group: 'surface' },
    ],
    // Declare meaningful separate parts here, with stable IDs and real pivots, for the gizmo.
    parts: [],
  },
  // Named param overrides, each exported as its own GLB: <slug>--<variant>.glb
  variants: {},
  // Surface-only looks on the same mesh (see rules/16): <slug>@<skin>.glb
  skins: {},
  build({ p, k }) {
    const asset = k.asset('{{SLUG_NAME}}');
    const body = k.part('body', { id: 'body' });
    const mat = k.mat.physical('painted-wood', { color: p.color });
    // Beyond boxes: k.shape.chamfered/rounded/spline → k.geo.extrude, k.geo.loft, k.geo.sweep,
    // k.geo.dualProfile (rules/17-complex-shapes.md, docs/KIT.md).
    body.add(k.mesh(k.geo.box(p.width, p.height, p.depth, { bevel: p.bevel, base: true }), mat));
    asset.add(body);
    return asset;
  },
});
