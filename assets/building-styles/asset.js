// Building Styles
// Prompt: One building in several architectural styles: Parisian Haussmann apartment block, Georgian town house, medieval timber-framed house and a modern house
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Building Styles',
    prompt: 'One building in several architectural styles: Parisian Haussmann apartment block, Georgian town house, medieval timber-framed house and a modern house',
    interpretation: 'The same plan language in four style presets of k.arch.building. Default: a six-storey Parisian Haussmann block, 15 × 12 m, cream ashlar with arched ground-floor openings, wrought-iron balconies on the 2nd and 5th floors and a zinc mansard with dormers and chimneys. Variants: a three-storey Georgian town house, a three-storey medieval timber-framed house with jettied upper floors, and a two-storey modern house with a flat roof. Each variant changes only the style name, the footprint and the floor count; the front faces +Z.',
    style: ['realistic'],
    category: 'architecture',
    budget: { triangles: 40000 },
  },
  seed: 1853,
  params: {
    style: 'paris-haussmann',
    width: 15,
    depth: 12,
    floors: 6,
    budget: 40000,
  },
  variants: {
    georgian: { style: 'georgian', width: 14, depth: 11, floors: 3 },
    medieval: { style: 'medieval-timber', width: 8, depth: 6.5, floors: 3 },
    modern: { style: 'modern', width: 13, depth: 9, floors: 2 },
  },
  build({ p, k }) {
    const asset = k.asset('building_styles');
    const house = k.arch.building({
      name: 'building',
      style: p.style,
      masses: [{ width: p.width, depth: p.depth, floors: p.floors }],
      budget: p.budget,
    });
    asset.add(house.part);
    return asset;
  },
});
