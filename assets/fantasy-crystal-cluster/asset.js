// Fantasy Crystal Cluster
// Prompt: "Fantasy crystal cluster growing from a mossy rock base, glowing purple crystals"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Fantasy Crystal Cluster',
    prompt: 'Fantasy crystal cluster growing from a mossy rock base, glowing purple crystals',
    interpretation: 'About 1 m wide: a low faceted rock with moss on its upward faces, one tall central crystal and a fan of smaller hexagonal crystals tilted outward, two violet tones with a soft inner glow, plus a few loose shards.',
    style: ['fantasy', 'stylized'],
    category: 'nature',
    budget: { triangles: 3000 },
  },
  seed: 808,
  params: {
    rockRadius: 0.45,
    crystals: 8,
    mainHeight: 1.1,
    crystalColors: ['#8a4fe0', '#b27bff'],
    glow: '#a45cff',
    glowStrength: 0.55,
    rockColor: '#6f6a64',
    mossColor: '#5f8a3a',
  },
  variants: {
    ice: { crystalColors: ['#59b8e8', '#a8e4ff'], glow: '#6fd6ff', mossColor: '#d9e6ee', seed: 81 },
  },
  build({ p, k, rng }) {
    const asset = k.asset('crystal_cluster');
    const rockMat = k.mat.physical('stone', { name: 'rock', color: p.rockColor });
    const moss = k.mat.pbr({ name: 'moss', color: p.mossColor, roughness: 0.9 });
    const crystalMats = p.crystalColors.map((c, i) => k.mat.pbr({ name: `crystal_${i + 1}`, color: c, roughness: 0.18, emissive: p.glow, emissiveIntensity: p.glowStrength * (i ? 0.7 : 1) }));

    // Rock base: faceted, flattened; upward-facing faces become moss.
    const base = k.part('rock');
    const rock = k.geo.rock(p.rockRadius, { detail: 2, roughness: 0.3, squash: [1.25, 0.5, 1.0], seed: rng.stream('rock').int(0, 1e6), base: true });
    base.add(k.mesh(k.op.keepFaces(rock, (c) => c.y < p.rockRadius * 0.42 || Math.abs(c.x) > p.rockRadius * 1.0), rockMat));
    base.add(k.mesh(k.op.keepFaces(rock, (c) => !(c.y < p.rockRadius * 0.42 || Math.abs(c.x) > p.rockRadius * 1.0)), moss));

    // Crystal: hexagonal prism with a pointed tip (lathe with 6 flat sides).
    const crystal = (r, h) => k.geo.lathe([[0, -0.05], [r, 0], [r * 0.92, h * 0.78], [0, h]], { segments: 6, flat: true });
    const crystals = k.part('crystals');
    const cr = rng.stream('crystals');
    const topY = p.rockRadius * 0.45;
    crystals.add(k.mesh(crystal(0.1, p.mainHeight), crystalMats[0], { at: [0.02, topY - 0.06, 0], rot: [0.05, 0.3, -0.06] }));
    for (let i = 0; i < p.crystals; i++) {
      const a = (i / p.crystals) * Math.PI * 2 + cr.jitter(0.3);
      const dist = cr.range(0.12, 0.3);
      const h = p.mainHeight * cr.range(0.32, 0.7);
      const tilt = cr.range(0.25, 0.65);
      const g = crystal(cr.range(0.045, 0.075), h);
      const m = k.mesh(g, crystalMats[i % 2], { at: [Math.cos(a) * dist, topY - 0.08, Math.sin(a) * dist] });
      m.rotation.set(Math.sin(a) * tilt, cr.range(0, Math.PI), -Math.cos(a) * tilt, 'YXZ');
      crystals.add(m);
    }
    // Loose shards on the ground.
    for (let i = 0; i < 4; i++) {
      const a = cr.range(0, Math.PI * 2);
      const d = p.rockRadius * cr.range(1.15, 1.4);
      const m = k.mesh(crystal(0.03, cr.range(0.1, 0.16)), crystalMats[1], { at: [Math.cos(a) * d, 0.03, Math.sin(a) * d * 0.8] });
      m.rotation.set(cr.range(1.25, 1.45), a, 0, 'YXZ'); // lying almost flat
      crystals.add(m);
    }
    asset.add(base, crystals);
    return asset;
  },
});
