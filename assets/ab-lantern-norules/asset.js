// A/B demo — "no rules" baseline.
// A deliberately naive reconstruction of what an agent typically writes for this prompt
// without rules/: correct parts list, but no proportions research, no bevels, no detail
// hierarchy, unrealistic material values. Kept for the Phase 3 side-by-side comparison.
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'A/B Lantern (no rules)',
    prompt: 'A medieval wall lantern on an iron bracket',
    interpretation: 'Naive baseline for the A/B comparison (see docs/demos/phase3-rules-ab.md).',
    style: ['medieval'],
    category: 'lighting',
    budget: { triangles: 3000 },
    origin: 'center',
  },
  seed: 1,
  params: {},
  build({ k }) {
    const asset = k.asset('lantern_naive');
    const iron = k.mat.pbr({ name: 'iron', color: '#000000', metalness: 1, roughness: 0.1 });
    const glass = k.mat.pbr({ name: 'glass', color: '#ffff00', roughness: 0.5 });
    asset.add(k.mesh(k.geo.box(0.05, 0.6, 0.6), iron, { at: [0, 0, 0] })); // wall plate
    asset.add(k.mesh(k.geo.box(0.05, 0.05, 0.8), iron, { at: [0, 0.2, 0.4] })); // arm
    asset.add(k.mesh(k.geo.box(0.6, 0.8, 0.6), glass, { at: [0, -0.3, 0.8] })); // lantern body
    asset.add(k.mesh(k.geo.box(0.7, 0.1, 0.7), iron, { at: [0, 0.15, 0.8] })); // top
    asset.add(k.mesh(k.geo.box(0.7, 0.1, 0.7), iron, { at: [0, -0.75, 0.8] })); // bottom
    return asset;
  },
});
