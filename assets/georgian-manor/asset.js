// Georgian Manor
// Prompt: Detailed Georgian manor house: symmetrical red-brick main block with two side wings, stone quoins and cornice, white sash windows, a columned portico with pediment at the entrance, hipped slate roofs with dormers and tall chimneys
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Georgian Manor',
    prompt: 'Detailed Georgian manor house: symmetrical red-brick main block with two side wings, stone quoins and cornice, white sash windows, a columned portico with pediment at the entrance, hipped slate roofs with dormers and tall chimneys',
    interpretation: 'Symmetrical Georgian country house, about 39 × 15 m: a three-storey main block (22 × 13 m, ground floor 3.8 m, upper floors 3.4 m) with two two-storey wings set back 2 m, all on a stone plinth. Red brick walls, ashlar quoins, string courses and a stepped cornice; white sash windows with keystones on the ground floor and pediments on the first (piano nobile) floor; a two-storey portico with four columns and a pediment over the central three bays; hipped slate roofs with dormers and tall end chimneys. Built with k.arch.building (style georgian); the front faces +Z.',
    style: ['realistic', 'georgian'],
    category: 'architecture',
    budget: { triangles: 60000 },
  },
  seed: 1714,
  params: {
    main: { width: 22, depth: 13, floors: 3 },
    wing: { width: 9, depth: 11, floors: 2, setback: 2, overlap: 0.5 },
    porticoFloors: 2,
    porticoColumns: 4,
    budget: 60000,
    // Surface (skins override only these)
    brick: '#9b4a35',
    mortar: '#d6ccbc',
    stone: '#ddd5c4',
    slate: '#4a5058',
    paint: '#f1eee6',
    door: '#1f2b26',
    wallKind: 'brick',
  },
  skins: {
    'dark-brick': { brick: '#5e2f26', mortar: '#a89d8c', stone: '#cfc6b3' },
    stucco: { wallKind: 'plaster', brick: '#e8e1d2', stone: '#f4f0e6', door: '#2b3b5a' },
    sandstone: { wallKind: 'ashlar', brick: '#c9a978', mortar: '#a88c62', stone: '#e3d2b0', slate: '#3e444b' },
  },
  build({ p, k }) {
    const asset = k.asset('georgian_manor');
    const M = p.main;
    const W = p.wing;
    const wingX = M.width / 2 + W.width / 2 - W.overlap;
    const wingZ = M.depth / 2 - W.setback - W.depth / 2;
    const house = k.arch.building({
      name: 'manor',
      style: 'georgian',
      masses: [
        { id: 'main', width: M.width, depth: M.depth, floors: M.floors },
        { id: 'west', x: -wingX, z: wingZ, width: W.width, depth: W.depth, floors: W.floors, chimneys: { count: 1 } },
        { id: 'east', x: wingX, z: wingZ, width: W.width, depth: W.depth, floors: W.floors, chimneys: { count: 1 } },
      ],
      portico: { columns: p.porticoColumns, bays: 3, floors: p.porticoFloors, depth: 2.8, radius: 0.36, pediment: true },
      finishes: {
        // The tile size stays fixed: UVs must not depend on skin params (rule 16).
        wall: { kind: p.wallKind, color: p.brick, mortar: p.mortar, tile: 1.2 },
        trim: { kind: 'ashlar', color: p.stone, tile: 1.8 },
        roof: { kind: 'slate', color: p.slate, tile: 1.5 },
        frame: { kind: 'paint', color: p.paint },
        door: { kind: 'paint', color: p.door },
      },
      budget: p.budget,
    });
    asset.add(house.part);
    return asset;
  },
});
