// Minimalist Chair
// Prompt: "Minimalist Scandinavian chair in light oak with a white seat"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Minimalist Oak Chair',
    prompt: 'Minimalist Scandinavian chair in light oak with a white seat',
    interpretation: 'Dining chair with a 45 cm seat height and 80 cm total height: four slim tapered round oak legs (rear legs continue up as back posts), thin side rails, a gently curved backrest band, and a soft white upholstered seat pad. Subtle oak grain texture with a normal map; clean rounded edges.',
    style: ['minimalist', 'scandinavian', 'realistic'],
    category: 'furniture',
    budget: { triangles: 4000 },
  },
  seed: 1960,
  params: {
    seatHeight: 0.45,
    seatWidth: 0.44,
    seatDepth: 0.42,
    backHeight: 0.8,
    legRadius: 0.018,
    oak: '#d9b98c',
    seat: '#f1efe9',
  },
  variants: {
    walnut: { oak: '#7a5236', seat: '#2e3033' },
  },
  build({ p, k }) {
    const asset = k.asset('chair');
    const T = 256;
    const grain = k.tex.create(T, T, { name: 'oak_grain', seed: 17 })
      .fill(p.oak)
      .noise({ color: '#000000', scale: 3, stretch: [1, 8], amount: 0.08, mode: 'multiply' })
      .grain({ color: '#000000', rings: 18, amount: 0.12, warp: 0.4, scale: 2, mode: 'multiply', seed: 4 });
    const grainH = k.tex.create(T, T, { space: 'linear', name: 'oak_height', seed: 18 })
      .fill(0.6)
      .grain({ color: 0.45, rings: 18, amount: 0.5, warp: 0.4, scale: 2, seed: 4 });
    const oak = k.mat.pbr({ name: 'oak', map: grain, normalMap: k.tex.normalFromHeight(grainH, { strength: 0.6 }), roughness: 0.48 });
    const fabric = k.mat.physical('fabric', { name: 'seat_fabric', color: p.seat, roughness: 0.92 });
    const uvs = 3; // oak repeats per meter (fine grain on thin parts)
    const SW = p.seatWidth;
    const SD = p.seatDepth;
    const SH = p.seatHeight;
    // Legs run along their own length; rotate UVs so the grain follows the leg.
    const leg = (h, rTop, rBottom) => k.uv.rotate(k.uv.cylindrical(k.geo.cylinder(rBottom, h, { radiusTop: rTop, segments: 14, base: true, bevel: 0.003 }), { scale: uvs }), Math.PI / 2);

    const frame = k.part('frame');
    const lx = SW / 2 - 0.03;
    const lzF = SD / 2 - 0.03;
    const lzB = -SD / 2 + 0.035;
    for (const sx of [-1, 1]) {
      frame.add(k.mesh(leg(SH - 0.02, p.legRadius * 1.15, p.legRadius * 0.8), oak, { at: [sx * lx, 0, lzF] }));
      // Rear leg + back post in one piece, leaning back slightly.
      const rear = k.mesh(leg(p.backHeight - 0.004, p.legRadius * 0.85, p.legRadius * 0.8), oak, { at: [sx * lx, 0, lzB], rot: [-0.08, 0, 0] });
      frame.add(rear);
      // Side rail under the seat.
      frame.add(k.mesh(k.uv.box(k.geo.box(0.018, 0.04, SD - 0.06, { bevel: 0.005, smooth: true }), { scale: uvs }), oak, { at: [sx * lx, SH - 0.06, (lzF + lzB) / 2] }));
    }
    // Front and back rails.
    for (const z of [lzF, lzB + 0.01]) {
      frame.add(k.mesh(k.uv.box(k.geo.box(SW - 0.06, 0.04, 0.018, { bevel: 0.005, smooth: true }), { scale: uvs }), oak, { at: [0, SH - 0.06, z] }));
    }
    // Curved backrest band: partial lathe (a shallow arc) with real thickness.
    // Built around its own middle so the lean rotates it in place, flush with the posts.
    const back = k.part('backrest');
    const R = 0.9;
    const arc = (SW + 0.02) / R;
    const bandH = 0.11;
    let band = k.geo.lathe([[R - 0.012, 0], [R + 0.012, 0], [R + 0.012, bandH], [R - 0.012, bandH]], { closed: true, phiStart: Math.PI - arc / 2, phiLength: arc, segments: 16, crease: 35 });
    band = k.op.translate(band, 0, -bandH / 2, R); // arc middle → origin
    band = k.op.rotate(band, -0.08, 0, 0); // same lean as the rear posts
    band = k.uv.box(band, { scale: uvs });
    const lean = 0.08;
    const backY = p.backHeight - bandH / 2 - 0.006;
    back.add(k.mesh(band, oak, { at: [0, backY, lzB - Math.sin(lean) * backY - 0.016] }));

    // Seat pad: soft rounded box.
    const seat = k.part('seat');
    seat.add(k.mesh(k.geo.box(SW, 0.05, SD, { bevel: 0.022, smooth: true, segments: 4 }), fabric, { at: [0, SH - 0.015, 0.0] }));
    asset.add(frame, back, seat);
    return asset;
  },
});
