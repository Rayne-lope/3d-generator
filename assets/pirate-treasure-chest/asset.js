// Pirate Treasure Chest
// Prompt: "Pirate treasure chest with a hinged lid, gold trim and a big lock"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Pirate Treasure Chest',
    prompt: 'Pirate treasure chest with a hinged lid, gold trim and a big lock',
    interpretation: '0.9 × 0.55 × 0.6 m chest: planked dark-wood box with a barrel-vault lid that is a separate part hinged at the back top edge (it can open in-engine), gold bands along edges and around the body, gold studs, and a big front lock plate with a padlock. Stylized proportions, flat colors.',
    style: ['stylized', 'pirate', 'fantasy'],
    category: 'container',
    budget: { triangles: 6000 },
  },
  seed: 1720,
  params: {
    width: 0.9,
    depth: 0.6,
    bodyHeight: 0.38,
    lidRise: 0.17, // vault height above the body
    planks: 5,
    bands: 2, // gold bands across the lid/body (besides edge trim)
    lockScale: 1.0,
    lidOpen: 0, // radians (0 = closed)
    wear: 0, // 0..1: chipped trim, missing studs, darker grime
    wood: '#6b4228',
    woodDark: '#4a2c1a',
    gold: '#e0b43c',
  },
  variants: {
    open: { lidOpen: 1.15 },
  },
  build({ p, k, rng }) {
    const asset = k.asset('treasure_chest');
    const woodColors = [p.wood, k.color.hex(k.color.shade(p.wood, -0.04)), k.color.hex(k.color.shade(p.wood, 0.03))];
    const woods = woodColors.map((c, i) => k.mat.pbr({ name: `chest_wood_${i + 1}`, color: k.color.hex(k.color.mix(c, '#2a1a10', p.wear * 0.35)), roughness: 0.8 }));
    const darkWood = k.mat.pbr({ name: 'chest_inner', color: p.woodDark, roughness: 0.9 });
    const gold = k.mat.pbr({ name: 'gold_trim', color: k.color.hex(k.color.mix(p.gold, '#6b5a3a', p.wear * 0.4)), roughness: 0.35 + p.wear * 0.2, metalness: 0 });
    const blackIron = k.mat.pbr({ name: 'lock_iron', color: '#2b2a2c', roughness: 0.6 });
    const W = p.width;
    const D = p.depth;
    const BH = p.bodyHeight;
    const pr = rng.stream('planks');
    const wearRng = rng.stream('wear');

    // ---- Body: dark inner box + horizontal planks on the four sides
    const body = k.part('body');
    body.add(k.mesh(k.geo.box(W - 0.04, BH - 0.01, D - 0.04, { base: true }), darkWood, { name: 'inner' }));
    const ph = BH / p.planks;
    for (let i = 0; i < p.planks; i++) {
      const y = ph * (i + 0.5);
      for (const [w, d, x, z] of [[W, 0.03, 0, D / 2 - 0.015], [W, 0.03, 0, -D / 2 + 0.015], [0.03, D - 0.06, W / 2 - 0.015, 0], [0.03, D - 0.06, -W / 2 + 0.015, 0]]) {
        const g = k.geo.plank(w, ph - 0.006, d, { seed: pr.int(0, 1e6), warp: 0.004, bevel: 0.005 });
        body.add(k.mesh(g, woods[pr.int(0, woods.length - 1)], { at: [x, y, z] }));
      }
    }
    // Gold trim: vertical corner bands and top/bottom rims.
    const trim = k.part('trim');
    const t = 0.012;
    const bw = 0.05;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        trim.add(k.mesh(k.geo.box(bw, BH, t, { bevel: 0.003 }), gold, { at: [sx * (W / 2 - bw / 2 + 0.004), BH / 2, sz * (D / 2 + t / 2)] }));
        trim.add(k.mesh(k.geo.box(t, BH, bw, { bevel: 0.003 }), gold, { at: [sx * (W / 2 + t / 2), BH / 2, sz * (D / 2 - bw / 2 + 0.004)] }));
      }
    }
    for (const y of [0.02, BH - 0.02]) {
      trim.add(k.mesh(k.geo.box(W + 2 * t, 0.035, t, { bevel: 0.003 }), gold, { at: [0, y, D / 2 + t / 2] }));
      trim.add(k.mesh(k.geo.box(W + 2 * t, 0.035, t, { bevel: 0.003 }), gold, { at: [0, y, -D / 2 - t / 2] }));
      trim.add(k.mesh(k.geo.box(t, 0.035, D, { bevel: 0.003 }), gold, { at: [W / 2 + t / 2, y, 0] }));
      trim.add(k.mesh(k.geo.box(t, 0.035, D, { bevel: 0.003 }), gold, { at: [-W / 2 - t / 2, y, 0] }));
    }
    // Studs along the bands (some missing when worn).
    for (let i = 0; i < 6; i++) {
      const x = -W / 2 + 0.08 + (i / 5) * (W - 0.16);
      for (const y of [0.02, BH - 0.02]) {
        if (wearRng.chance(p.wear * 0.5)) continue;
        trim.add(k.mesh(k.geo.sphere(0.009, { widthSegments: 8, heightSegments: 5, hemisphere: true }), gold, { at: [x, y, D / 2 + t], rot: [Math.PI / 2, 0, 0] }));
      }
    }

    // ---- Lid: barrel vault, separate part hinged at the back top edge
    const lid = k.part('lid', { separate: true, pivot: [0, BH, -D / 2] });
    const rise = p.lidRise;
    const R = (D * D / 4 + rise * rise) / (2 * rise); // circle through both eaves and the crown
    const cy = BH + rise - R;
    const half = Math.asin(D / 2 / R);
    // Vault shell as a partial lathe rotated so its axis runs along X.
    let vault = k.geo.lathe([[R - 0.03, -W / 2], [R, -W / 2], [R, W / 2], [R - 0.03, W / 2]], { closed: true, phiStart: -half, phiLength: 2 * half, segments: 18, crease: 30 });
    vault = k.op.lieAlong(vault, 'x'); // axis along the chest width, crown on top
    lid.add(k.mesh(vault, woods[0], { at: [0, cy, 0], name: 'vault' }));
    // End caps: extruded segments closing the vault ends.
    const capShape = k.shape.polygon([...Array.from({ length: 13 }, (_, i) => {
      const a = -half + (i / 12) * 2 * half;
      return [Math.sin(a) * R, Math.cos(a) * R + cy - BH];
    })]);
    for (const sx of [-1, 1]) {
      let cap = k.geo.extrude(capShape, 0.03, { axis: 'x' });
      lid.add(k.mesh(cap, woods[1], { at: [sx * (W / 2 - 0.015), BH, 0], name: 'lid_end' }));
    }
    // Gold bands over the lid (edge bands + p.bands across).
    const bandXs = [-W / 2 + bw / 2, W / 2 - bw / 2];
    for (let i = 0; i < p.bands; i++) bandXs.push(-W / 2 + ((i + 1) / (p.bands + 1)) * W);
    for (const x of bandXs) {
      let band = k.geo.lathe([[R, -bw / 2], [R + t, -bw / 2], [R + t, bw / 2], [R, bw / 2]], { closed: true, phiStart: -half - 0.02, phiLength: 2 * half + 0.04, segments: 18, crease: 30 });
      band = k.op.lieAlong(band, 'x');
      lid.add(k.mesh(band, gold, { at: [x, cy, 0], name: 'lid_band' }));
    }
    // Front lip of the lid.
    lid.add(k.mesh(k.geo.box(W + 2 * t, 0.03, t, { bevel: 0.003 }), gold, { at: [0, BH + 0.015, D / 2 + t / 2] }));
    // Body bands continue the lid bands down the front and back.
    for (const x of bandXs.slice(2)) {
      for (const sz of [-1, 1]) trim.add(k.mesh(k.geo.box(bw, BH, t, { bevel: 0.003 }), gold, { at: [x, BH / 2, sz * (D / 2 + t / 2)] }));
    }

    // ---- Lock: plate on the body front + hasp on the lid + padlock
    const lock = k.part('lock');
    const L = p.lockScale;
    lock.add(k.mesh(k.geo.box(0.14 * L, 0.12 * L, 0.012, { bevel: 0.004 }), gold, { at: [0, BH - 0.07 * L, D / 2 + t + 0.006] }));
    lock.add(k.mesh(k.geo.box(0.02 * L, 0.035 * L, 0.004), blackIron, { at: [0, BH - 0.075 * L, D / 2 + t + 0.013], name: 'keyhole' }));
    const pad = k.group('padlock');
    pad.add(k.mesh(k.geo.box(0.1 * L, 0.09 * L, 0.035 * L, { bevel: 0.012 * L, smooth: true }), blackIron, { at: [0, BH - 0.105 * L, D / 2 + t + 0.03 * L] }));
    pad.add(k.mesh(k.geo.torus(0.032 * L, 0.008 * L, { axis: 'z', arc: Math.PI, tubularSegments: 12, radialSegments: 6 }), blackIron, { at: [0, BH - 0.06 * L, D / 2 + t + 0.03 * L] }));
    lock.add(pad);
    lid.add(k.mesh(k.geo.box(0.07 * L, 0.08 * L, 0.012, { bevel: 0.004 }), gold, { at: [0, BH + 0.01, D / 2 + t + 0.014], name: 'hasp' }));

    if (p.lidOpen) lid.rotation.x = -p.lidOpen;
    asset.add(body, trim, lid, lock);
    return asset;
  },
});
