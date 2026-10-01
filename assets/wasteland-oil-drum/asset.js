// Wasteland Oil Drum
// Prompt: "Post-apocalyptic rusty oil drum, dented, with faded hazard stripes"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Wasteland Oil Drum',
    prompt: 'Post-apocalyptic rusty oil drum, dented, with faded hazard stripes',
    interpretation: 'Standard 55-gallon steel drum (0.88 m × Ø0.57 m) with two rolling hoops, rolled rims and bung caps on the lid. Faded red paint eaten by rust, a worn yellow/black hazard band, scratches with bare metal, grime from the ground up, and a few dents.',
    style: ['post-apocalyptic', 'realistic'],
    category: 'container',
    budget: { triangles: 4000 },
  },
  seed: 1955,
  params: {
    height: 0.88,
    radius: 0.285,
    rust: 0.45,
    dents: 3,
    paint: '#8f2f22',
    textureSize: 512,
  },
  variants: {
    fresh: { rust: 0.12, dents: 0, paint: '#2f5d8f', seed: 7 },
  },
  build({ p, k, rng }) {
    const asset = k.asset('oil_drum');
    const H = p.height;
    const R = p.radius;
    const T = p.textureSize;
    // UV: cylindrical, 1 texture repeat = half the circumference (2 repeats around, seamless).
    const circ = 2 * Math.PI * R;
    const uvScale = 2 / circ;
    // Base paint + rust + hazard band (band sits at 45–58% of the height).
    const paint = k.tex.create(T, T, { name: 'drum_paint', seed: 3 })
      .fill(p.paint)
      .noise({ color: '#5f1d15', scale: 3, amount: 0.35 })
      .noise({ color: '#c46a4a', scale: 8, amount: 0.15, mode: 'screen' });
    // Hazard band: v range for y in [0.45H, 0.58H] → v = 1 - frac(y * scale) mapping (rows near the top of the tile).
    const v0 = (0.58 * H * uvScale) % 1;
    const v1 = (0.45 * H * uvScale) % 1;
    const bandA = 1 - v0;
    const bandB = 1 - v1;
    paint.clip([0, Math.min(bandA, bandB), 1, Math.max(bandA, bandB)], (b) => {
      b.fill('#d9a520').stripes({ count: 6, axis: 'u', width: 0.5, color: '#1d1d1d', angle: 0.6, soft: 0.01 });
      b.noise({ color: '#8f2f22', scale: 6, amount: 0.5, threshold: 0.62, softness: 0.05 });
    });
    paint.rust({ amount: p.rust, scale: 6, seed: 21 })
      .noise({ color: '#6e3216', scale: 5, stretch: [1, 9], amount: 0.55 * p.rust, threshold: 0.58, softness: 0.08, seed: 23 }) // rust runs
      .scratches({ count: 60, color: '#b8b3a8', alpha: 0.45, width: 0.0015 })
      .dirt({ color: '#3a2a1c', amount: 0.55, scale: 5, from: 'bottom' });
    const metal = k.tex.create(T, T, { space: 'linear', name: 'drum_metal', seed: 4 })
      .fill(0)
      .scratches({ count: 60, color: 1, alpha: 0.9, width: 0.0015, seed: paint.seed });
    const rough = k.tex.create(T, T, { space: 'linear', name: 'drum_rough', seed: 5 })
      .fill(0.55)
      .rust({ amount: p.rust, scale: 6, seed: 21, color: '#e6e6e6', rim: '#d0d0d0' })
      .noise({ color: 0.7, scale: 6, amount: 0.3 });
    const orm = k.tex.orm({ roughness: rough, metalness: metal });
    const bump = k.tex.create(T, T, { space: 'linear', name: 'drum_height', seed: 6 })
      .fill(0.5)
      .rust({ amount: p.rust, scale: 6, seed: 21, color: '#5a5a5a', rim: '#707070' })
      .blur(1);
    const drum = k.mat.pbr({ name: 'drum', map: paint, ormMap: orm, normalMap: k.tex.normalFromHeight(bump, { strength: 1.2 }), roughness: 1, metalness: 1 });
    const steel = k.mat.pbr({ name: 'drum_steel', color: '#6d6a66', roughness: 0.6, metalness: 0 });
    // Lid: its own paint (no hazard band, no ground grime) so the planar lid UVs show no seams.
    const lidPaint = k.tex.create(256, 256, { name: 'drum_lid', seed: 8 })
      .fill(p.paint)
      .noise({ color: '#5f1d15', scale: 3, amount: 0.35 })
      .rust({ amount: p.rust * 1.2, scale: 3, seed: 31 })
      .scratches({ count: 25, color: '#b8b3a8', alpha: 0.4, width: 0.002 });
    const lid = k.mat.pbr({ name: 'drum_lid', map: lidPaint, roughness: 0.7, metalness: 0 });

    const body = k.part('body');
    // Shell with two rolling hoops and rolled rims, all in one lathe profile.
    const hoop = (y, w = 0.012, d = 0.01) => [[R, y - w], [R + d, y - w * 0.4], [R + d, y + w * 0.4], [R, y + w]];
    const prof = [[0, 0.004], [R - 0.012, 0.004], [R + 0.004, 0.01], [R + 0.004, 0.024], [R, 0.03], ...hoop(H / 3), ...hoop((2 * H) / 3), [R, H - 0.03], [R + 0.004, H - 0.024], [R + 0.004, H - 0.01], [R - 0.012, H - 0.004], [R - 0.02, H - 0.012], [0, H - 0.012]];
    let shell = k.geo.lathe(prof, { segments: 36, crease: 32 });
    const dr = rng.stream('dents');
    for (let i = 0; i < p.dents; i++) {
      const a = dr.range(0, Math.PI * 2);
      const y = dr.range(0.15, 0.85) * H;
      shell = k.op.dent(shell, { at: [Math.sin(a) * R, y, Math.cos(a) * R], radius: dr.range(0.1, 0.16), depth: dr.range(0.035, 0.06) });
    }
    shell = k.uv.cylindrical(shell, { scale: uvScale, radius: R });
    const isLid = (c) => c.y > H - 0.02 && Math.hypot(c.x, c.z) < R - 0.015;
    body.add(k.mesh(k.op.keepFaces(shell, (c) => !isLid(c)), drum));
    body.add(k.mesh(k.uv.planar(k.op.keepFaces(shell, isLid), { axis: 'y', scale: 1.5 }), lid, { name: 'lid' }));
    // Bung caps on the lid.
    for (const [x, z, r] of [[R * 0.55, 0, 0.032], [-R * 0.55, 0.05, 0.022]]) {
      body.add(k.mesh(k.geo.cylinder(r, 0.012, { segments: 12, bevel: 0.003, base: true }), steel, { at: [x, H - 0.013, z] }));
      body.add(k.mesh(k.geo.prism(6, r * 0.55, 0.008, { base: true }), steel, { at: [x, H - 0.002, z] }));
    }
    asset.add(body);
    return asset;
  },
});
