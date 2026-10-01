// Modular Castle Wall
// Prompt: "Modular castle stone wall segment, 4 m wide, tileable edges"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Modular Castle Wall',
    prompt: 'Modular castle stone wall segment, 4 m wide, tileable edges',
    interpretation: '4 m × 3 m wall, 0.8 m thick, with a walkway ledge and crenellations on top. Ends are cut flat at x = ±2 m so segments snap edge to edge; origin at the base center. Stone-block texture with mortar and a normal map at 256 px/m. Variants: corner tower block, and a segment with an arched window.',
    style: ['medieval', 'realistic'],
    category: 'modular',
    budget: { triangles: 6000 },
  },
  seed: 1215,
  params: {
    width: 4,
    height: 3,
    thickness: 0.8,
    merlonWidth: 0.6,
    merlonHeight: 0.55,
    window: false,
    corner: false,
    stone: '#9b958a',
    mortar: '#6c665d',
  },
  variants: {
    window: { window: true },
    corner: { corner: true, width: 1.6 },
  },
  build({ p, k }) {
    const asset = k.asset('castle_wall');
    const T = 512;
    // Stone blocks: 1 texture repeat = 2 m of wall.
    const color = k.tex.create(T, T, { name: 'castle_stone', seed: 40 })
      .fill(p.stone)
      .bricks({ rows: 7, cols: 3, mortar: 0.02, mortarColor: p.mortar, vary: 0.2, jitterColor: '#857a68', offset: 0.37 })
      .noise({ color: '#6d685f', scale: 8, amount: 0.35 })
      .noise({ color: '#b3ab9c', scale: 3, amount: 0.25, mode: 'screen' })
      .noise({ color: '#4f6b3a', scale: 5, amount: 0.25, threshold: 0.72, softness: 0.06 }) // moss specks
      .dirt({ color: '#3b362e', amount: 0.3, scale: 4, from: 'bottom' });
    const height = k.tex.create(T, T, { space: 'linear', name: 'castle_stone_h', seed: 41 })
      .fill(0.7)
      .bricks({ rows: 7, cols: 3, mortar: 0.02, mortarColor: 0.15, vary: 0.3, offset: 0.37, seed: color.seed })
      .noise({ color: 0.45, scale: 10, amount: 0.4 })
      .blur(1);
    const stone = k.mat.pbr({ name: 'castle_stone', map: color, normalMap: k.tex.normalFromHeight(height, { strength: 2.2 }), roughness: 0.9 });
    const uv = 0.5; // texture repeats per meter (one repeat per 2 m)
    const W = p.width;
    const H = p.height;
    const D = p.thickness;
    const wall = k.part('wall');

    if (p.corner) {
      // Square corner block a little taller than the wall, crenellated on all sides.
      wall.add(k.mesh(k.uv.box(k.geo.box(W, H + 0.3, W, { bevel: 0.02, base: true }), { scale: uv }), stone));
      // Merlons: one on each corner (shared by both sides) and one in the middle of each side.
      const mw = p.merlonWidth;
      const inset = W / 2 - mw / 2;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          wall.add(k.mesh(k.uv.box(k.geo.box(mw, p.merlonHeight, mw, { bevel: 0.02, base: true }), { scale: uv }), stone, { at: [sx * inset, H + 0.3, sz * inset] }));
        }
      }
      if (W > mw * 3.2) {
        for (const [x, z, w, d] of [[0, inset + mw / 4, mw, mw / 2], [0, -inset - mw / 4, mw, mw / 2], [inset + mw / 4, 0, mw / 2, mw], [-inset - mw / 4, 0, mw / 2, mw]]) {
          wall.add(k.mesh(k.uv.box(k.geo.box(w, p.merlonHeight, d, { bevel: 0.02, base: true }), { scale: uv }), stone, { at: [x, H + 0.3, z] }));
        }
      }
      asset.add(wall);
      return asset;
    }

    // Main wall with an optional arched window (clean opening via k.arch.wall).
    const openings = p.window ? [{ x: 0, y: 1.0, w: 0.7, h: 1.2, shape: 'arch' }] : [];
    let g = k.arch.wall({ width: W, height: H, thickness: D, openings });
    g = k.uv.box(g, { scale: uv });
    wall.add(k.mesh(g, stone));
    // Plinth (wider base course) and a walkway ledge behind the parapet.
    wall.add(k.mesh(k.uv.box(k.geo.box(W, 0.35, D + 0.12, { bevel: 0.02, base: true }), { scale: uv }), stone));
    wall.add(k.mesh(k.uv.box(k.geo.box(W, 0.12, 0.3, { bevel: 0.015 }), { scale: uv }), stone, { at: [0, H - 0.1, -D / 2 - 0.14] }));
    // Crenellations on the front half of the top; spacing tiles across segments (gap at the ends is half a crenel).
    const count = Math.round(W / (p.merlonWidth * 2));
    const pitch = W / count;
    for (let i = 0; i < count; i++) {
      const x = -W / 2 + pitch / 2 + i * pitch;
      wall.add(k.mesh(k.uv.box(k.geo.box(p.merlonWidth, p.merlonHeight, D * 0.45, { bevel: 0.02, base: true }), { scale: uv }), stone, { at: [x, H, D * 0.275] }));
    }
    // Low parapet lip between merlons.
    wall.add(k.mesh(k.uv.box(k.geo.box(W, 0.12, D * 0.45, { bevel: 0.015, base: true }), { scale: uv }), stone, { at: [0, H, D * 0.275] }));
    if (p.window) {
      // Stone surround: its opening is 4 cm smaller than the wall's, so no faces coincide.
      wall.add(k.mesh(k.uv.box(k.arch.frame({ w: 0.66, h: 1.18, border: 0.14, depth: D + 0.06, shape: 'arch', bottom: true }), { scale: uv }), stone, { at: [0, 1.02, 0] }));
    }
    asset.add(wall);
    return asset;
  },
});
