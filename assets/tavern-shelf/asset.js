// Tavern Wall Shelf — member of the 'tavern' set
import { defineAsset } from '../../studio/kit/index.js';
import style from '../../sets/tavern/style.js';

export default defineAsset({
  meta: {
    title: 'Tavern Wall Shelf',
    prompt: 'Cozy fantasy tavern props: a trestle table, a stool, a wooden mug, a candle holder and a wall shelf',
    interpretation: 'Wall-mounted two-tier shelf, 1.0 m wide and 0.6 m tall: a backboard rail, two chunky plank shelves on curled iron brackets. Origin at the back center so it snaps flush against a wall.',
    style: ['stylized', 'cozy', 'fantasy'],
    category: 'furniture',
    budget: { triangles: 3000 },
    origin: 'back-center',
    set: 'tavern',
  },
  seed: 305,
  params: { width: 1.0, depth: 0.24, tiers: 2, spacing: 0.32 },
  build({ p, k }) {
    const m = style.materials(k);
    const asset = k.asset('tavern_shelf');
    const T = style.dims.plank;
    const shelves = k.part('shelves');
    for (let i = 0; i < p.tiers; i++) {
      const y = 0.1 + i * p.spacing + T;
      const board = style.planks(k, m, { width: p.width, depth: p.depth, count: 2, seed: 40 + i });
      board.position.set(0, y, p.depth / 2);
      shelves.add(board);
      // Front lip.
      shelves.add(k.mesh(k.geo.box(p.width, 0.03, 0.02, { bevel: 0.006 }), m.woodDark, { at: [0, y + 0.012, p.depth - 0.01] }));
    }
    // Back rail mounted on the wall.
    shelves.add(k.mesh(k.geo.box(p.width * 0.9, 0.09, 0.025, { bevel: style.dims.bevel }), m.woodDark, { at: [0, 0.1 + (p.tiers - 1) * p.spacing + 0.2, 0.0125] }));
    const brackets = k.part('brackets');
    for (let i = 0; i < p.tiers; i++) {
      const y = 0.1 + i * p.spacing;
      for (const x of [-p.width * 0.36, p.width * 0.36]) {
        brackets.add(k.mesh(k.geo.box(0.02, 0.012, p.depth * 0.85, { bevel: 0.003 }), m.iron, { at: [x, y + 0.004, p.depth * 0.425] }));
        // Wall plate: slightly narrower and lower than the arm so no faces coincide (no z-fighting).
        brackets.add(k.mesh(k.geo.box(0.017, 0.115, 0.012, { bevel: 0.003 }), m.iron, { at: [x, y - 0.0525, 0.006] }));
        const curl = [];
        for (let s = 0; s <= 14; s++) {
          const t = s / 14;
          curl.push([x, y - 0.1 * (1 - t) - 0.005, 0.012 + t * p.depth * 0.6 - Math.sin(t * Math.PI) * 0.03]);
        }
        brackets.add(k.mesh(k.geo.tube(curl, 0.006, { segments: 16, radialSegments: 6 }), m.iron));
      }
    }
    asset.add(shelves, brackets);
    return asset;
  },
});
