// Medieval Townhouse
// Prompt: Medieval timber-framed townhouse: stone ground floor, two jettied upper floors with dark oak framing and plaster, steep clay-tile gable roof and a stone chimney
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Medieval Townhouse',
    prompt: 'Medieval timber-framed townhouse: stone ground floor, two jettied upper floors with dark oak framing and plaster, steep clay-tile gable roof and a stone chimney',
    interpretation: 'Late-medieval town house, 7.5 × 6 m at the ground, three storeys: a rubble-stone ground floor with an arched plank door, two upper floors jettied 0.4 m out over the street (front and back) with dark oak posts, rails and chevron braces over cream plaster, small leaded windows, a steep 52° clay-tile gable roof with the ridge along the street and a stone end chimney. Built with k.arch.building (style medieval-timber); the front faces +Z.',
    style: ['medieval', 'realistic'],
    category: 'architecture',
    budget: { triangles: 20000 },
  },
  seed: 1480,
  params: {
    width: 7.5,
    depth: 6,
    floors: 3,
    jetty: 0.4,
    plaster: '#e4d9bf',
    timber: '#3b2a1e',
    stone: '#9a948a',
    tiles: '#8e4b33',
  },
  variants: {
    narrow: { width: 5, floors: 4 },
  },
  skins: {
    ochre: { plaster: '#d9a75a', timber: '#2b2018' },
    whitewash: { plaster: '#f2f0ea', timber: '#1d1a17', tiles: '#5b4a42' },
  },
  build({ p, k }) {
    const asset = k.asset('medieval_townhouse');
    const house = k.arch.building({
      name: 'townhouse',
      style: 'medieval-timber',
      masses: [{ width: p.width, depth: p.depth, floors: p.floors, jetty: { amount: p.jetty, sides: ['front', 'back'] } }],
      finishes: {
        wall: { kind: 'plaster', color: p.plaster, tile: 2 },
        timber: { kind: 'timber', color: p.timber, tile: 1.5 },
        trim: { kind: 'rubble', color: p.stone, tile: 1.6 },
        roof: { kind: 'clay-tiles', color: p.tiles, tile: 1.4 },
      },
      budget: 20000,
    });
    asset.add(house.part);
    return asset;
  },
});
