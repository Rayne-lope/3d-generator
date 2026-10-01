// Stone Cottage
// Prompt: "Small stone cottage with a wooden door, two windows, a chimney and a thatched roof"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Stone Cottage',
    prompt: 'Small stone cottage with a wooden door, two windows, a chimney and a thatched roof',
    interpretation: 'One-room cottage, 5 × 4 m footprint, 2.6 m stone walls on a low plinth: a planked wooden door with frame and step at the front, a window either side with timber frames, sills and mullions, gable walls, a thick rounded thatch roof with generous overhang, and a stone chimney on one gable. Door 0.95 × 2.0 m and windows at 0.9 m sill height match human scale.',
    style: ['stylized', 'medieval', 'cozy'],
    category: 'architecture',
    budget: { triangles: 12000 },
  },
  seed: 1640,
  params: {
    width: 5,
    depth: 4,
    wallHeight: 2.6,
    wallThickness: 0.35,
    roofPitch: 45,
    roofOverhang: 0.45,
    thatchThickness: 0.32,
    door: { w: 0.95, h: 2.0 },
    window: { w: 0.8, h: 0.9, sill: 0.95 },
    stone: '#a39d90',
    mortar: '#6f6a60',
    thatch: '#c9a35a',
    timber: '#6e4a2e',
    glass: '#33465a',
  },
  variants: {
    winter: { thatch: '#e8ecef', stone: '#8d8a84', seed: 2 },
  },
  build({ p, k }) {
    const asset = k.asset('cottage');
    const W = p.width;
    const D = p.depth;
    const H = p.wallHeight;
    const T = p.wallThickness;
    // Stone texture (tiling, 1 repeat per 1.5 m) with a matching normal map.
    const stoneTex = k.tex.create(512, 512, { name: 'cottage_stone', seed: 61 })
      .fill(p.stone)
      .bricks({ rows: 6, cols: 3, mortar: 0.03, mortarColor: p.mortar, vary: 0.22, offset: 0.43, jitterColor: '#8f8574' })
      .noise({ color: '#7d776c', scale: 7, amount: 0.3 })
      .dirt({ color: '#4a4237', amount: 0.25, from: 'bottom' });
    const stoneH = k.tex.create(512, 512, { space: 'linear', name: 'cottage_stone_h', seed: 62 })
      .fill(0.75)
      .bricks({ rows: 6, cols: 3, mortar: 0.03, mortarColor: 0.1, vary: 0.35, offset: 0.43, seed: stoneTex.seed })
      .noise({ color: 0.5, scale: 9, amount: 0.35 })
      .blur(1);
    const stone = k.mat.pbr({ name: 'cottage_stone', map: stoneTex, normalMap: k.tex.normalFromHeight(stoneH, { strength: 2.4 }), roughness: 0.9 });
    // Thatch: dense straw streaks running down the slope, with soft course bands.
    const thatchTex = k.tex.create(512, 512, { name: 'thatch', seed: 63 })
      .fill(p.thatch)
      .noise({ color: '#6f5426', scale: 4, stretch: [18, 1], amount: 0.85, contrast: 1.7 }) // straw bundles, long down the slope
      .noise({ color: '#f3dca4', scale: 6, stretch: [22, 1], amount: 0.45, mode: 'screen', contrast: 1.6 })
      .stripes({ count: 5, axis: 'v', width: 0.3, color: '#6e5226', alpha: 0.12, soft: 0.1 });
    const thatch = k.mat.pbr({ name: 'thatch', map: thatchTex, roughness: 0.95 });
    const timber = k.mat.pbr({ name: 'timber', color: p.timber, roughness: 0.8 });
    const timberDark = k.mat.pbr({ name: 'timber_dark', color: k.color.hex(k.color.shade(p.timber, -0.1)), roughness: 0.85 });
    const glass = k.mat.pbr({ name: 'window_glass', color: p.glass, roughness: 0.15 });
    const uv = 1 / 1.5;

    const walls = k.part('walls');
    const win = p.window;
    // Front wall: door in the middle, a window each side.
    let front = k.arch.wall({ width: W, height: H, thickness: T, openings: [
      { x: 0, y: 0, w: p.door.w, h: p.door.h },
      { x: -W * 0.3, y: win.sill, w: win.w, h: win.h },
      { x: W * 0.3, y: win.sill, w: win.w, h: win.h },
    ] });
    walls.add(k.mesh(k.uv.box(front, { scale: uv }), stone, { at: [0, 0, D / 2 - T / 2] }));
    walls.add(k.mesh(k.uv.box(k.arch.wall({ width: W, height: H, thickness: T, openings: [{ x: W * 0.15, y: win.sill, w: win.w, h: win.h }] }), { scale: uv }), stone, { at: [0, 0, -D / 2 + T / 2] }));
    // Gable walls (side walls with the triangular gable), between front and back walls.
    const rise = Math.tan((p.roofPitch * Math.PI) / 180) * (D / 2);
    for (const sx of [-1, 1]) {
      let gw = k.arch.wall({ width: D - 2 * T + 0.002, height: H, thickness: T, gableHeight: rise });
      gw = k.op.rotate(gw, 0, Math.PI / 2, 0);
      walls.add(k.mesh(k.uv.box(gw, { scale: uv }), stone, { at: [sx * (W / 2 - T / 2), 0, 0] }));
    }
    // Plinth course around the base.
    walls.add(k.mesh(k.uv.box(k.geo.box(W + 0.12, 0.3, D + 0.12, { bevel: 0.03, base: true }), { scale: uv }), stone));

    // Door: planked leaf set into the opening, frame, step.
    const door = k.part('door', { separate: true, pivot: [-p.door.w / 2, 0, D / 2 - T * 0.35] });
    for (let i = 0; i < 5; i++) {
      const pw = p.door.w / 5;
      door.add(k.mesh(k.geo.plank(pw - 0.004, p.door.h - 0.02, 0.05, { seed: 70 + i, warp: 0.004 }), i % 2 ? timber : timberDark, { at: [-p.door.w / 2 + pw * (i + 0.5), p.door.h / 2, D / 2 - T * 0.35] }));
    }
    for (const y of [0.35, p.door.h - 0.4]) door.add(k.mesh(k.geo.box(p.door.w - 0.08, 0.1, 0.03, { bevel: 0.008 }), timberDark, { at: [0, y, D / 2 - T * 0.35 + 0.04] }));
    door.add(k.mesh(k.geo.sphere(0.03, { widthSegments: 10, heightSegments: 6 }), timberDark, { at: [p.door.w * 0.35, 1.0, D / 2 - T * 0.35 + 0.07] }));
    const trims = k.part('trims');
    trims.add(k.mesh(k.arch.frame({ w: p.door.w, h: p.door.h, border: 0.1, depth: 0.08, bottom: false }), timber, { at: [0, 0, D / 2 + 0.01] }));
    trims.add(k.mesh(k.uv.box(k.geo.box(p.door.w + 0.5, 0.18, 0.5, { bevel: 0.03, base: true }), { scale: uv }), stone, { at: [0, 0, D / 2 + 0.25] }));

    // Windows: frame, sill, cross mullions, dark glass (set back in the reveal).
    const windowAt = (x, z, facing) => {
      const g = k.group('window');
      g.add(k.mesh(k.arch.frame({ w: win.w, h: win.h, border: 0.08, depth: 0.08 }), timber, { at: [0, win.sill, 0.01] }));
      g.add(k.mesh(k.geo.box(win.w + 0.24, 0.06, 0.16, { bevel: 0.015 }), timber, { at: [0, win.sill - 0.11, 0.06] }));
      g.add(k.mesh(k.geo.box(win.w, win.h, 0.02), glass, { at: [0, win.sill + win.h / 2, -T * 0.4] }));
      g.add(k.mesh(k.geo.box(0.05, win.h, 0.05), timber, { at: [0, win.sill + win.h / 2, -T * 0.38] }));
      g.add(k.mesh(k.geo.box(win.w, 0.05, 0.05), timber, { at: [0, win.sill + win.h * 0.55, -T * 0.38] }));
      g.position.set(x, 0, z);
      g.rotation.y = facing;
      trims.add(g);
    };
    windowAt(-W * 0.3, D / 2, 0);
    windowAt(W * 0.3, D / 2, 0);
    windowAt(W * 0.15, -D / 2, Math.PI);

    // Thatch roof: thick gable with a rounded ridge roll; ridge along X.
    const roof = k.part('roof');
    let rg = k.arch.roof({ type: 'gable', width: W, depth: D, pitch: p.roofPitch, overhang: p.roofOverhang, thickness: p.thatchThickness });
    rg = k.uv.box(rg, { scale: 1.2 });
    roof.add(k.mesh(rg, thatch, { at: [0, H, 0] }));
    let ridge = k.geo.cylinder(p.thatchThickness * 0.75, W + 2 * p.roofOverhang + 0.1, { segments: 14 });
    ridge = k.op.lieAlong(ridge, 'x');
    roof.add(k.mesh(k.uv.box(ridge, { scale: 1.2 }), thatch, { at: [0, H + rise + p.thatchThickness * 0.1, 0] }));

    // Chimney on the right gable, rising through the roof.
    const chim = k.part('chimney');
    const cx = W / 2 - 0.05;
    chim.add(k.mesh(k.uv.box(k.geo.box(0.75, H + rise + 0.9, 0.9, { bevel: 0.03, base: true }), { scale: uv }), stone, { at: [cx, 0, -0.4] }));
    chim.add(k.mesh(k.uv.box(k.geo.box(0.85, 0.12, 1.0, { bevel: 0.02, base: true }), { scale: uv }), stone, { at: [cx, H + rise + 0.9, -0.4] }));
    chim.add(k.mesh(k.geo.box(0.45, 0.02, 0.55), timberDark, { at: [cx, H + rise + 1.025, -0.4], name: 'flue' }));
    asset.add(walls, door, trims, roof, chim);
    return asset;
  },
});
