// Low-poly Pine Tree
// Prompt: "Low-poly pine tree, faceted, 3 tiers, for a cozy forest game"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Low-poly Pine Tree',
    prompt: 'Low-poly pine tree, faceted, 3 tiers, for a cozy forest game',
    interpretation: 'About 3.2 m conifer: short flared trunk and three stacked, slightly tilted faceted cones in two warm greens, flat shading throughout. Seed variants give a small forest of unique trees.',
    style: ['low-poly', 'stylized', 'cozy'],
    category: 'nature',
    budget: { triangles: 900 },
  },
  seed: 31,
  params: {
    height: 3.2,
    trunkHeight: 0.75,
    trunkRadius: 0.13,
    tiers: 3,
    baseRadius: 1.0, // radius of the lowest tier
    tierShrink: 0.72, // each tier is this much narrower
    sides: 7,
    jitter: 0.07, // vertex wobble (faceted, hand-made look)
    lean: 0.06, // per-tier random tilt (radians)
    greens: ['#4e8a3c', '#3e7434', '#5c9a45'],
    trunkColor: '#6b4a32',
  },
  variants: {
    b: { seed: 912, height: 2.7, baseRadius: 0.9 },
    c: { seed: 4477, height: 3.6, tiers: 4, baseRadius: 1.05, tierShrink: 0.76 },
  },
  build({ p, k, rng }) {
    const asset = k.asset('pine');
    const bark = k.mat.pbr({ name: 'bark', color: p.trunkColor, roughness: 0.9 });
    const greens = p.greens.map((c, i) => k.mat.pbr({ name: `needles_${i + 1}`, color: c, roughness: 0.85 }));

    const trunk = k.part('trunk');
    let tg = k.geo.cylinder(p.trunkRadius, p.trunkHeight + 0.3, { radiusTop: p.trunkRadius * 0.7, segments: 6, base: true, flat: true });
    tg = k.op.jitter(tg, { amount: 0.012, seed: rng.stream('trunk').int(0, 1e6) });
    trunk.add(k.mesh(tg, bark));
    // Root flare: a squat wider cone at the base.
    trunk.add(k.mesh(k.op.jitter(k.geo.cylinder(p.trunkRadius * 1.6, 0.16, { radiusTop: p.trunkRadius, segments: 6, base: true, flat: true }), { amount: 0.015, seed: 7 }), bark));

    const crown = k.part('crown');
    const tierRng = rng.stream('tiers');
    const crownHeight = p.height - p.trunkHeight;
    let y = p.trunkHeight;
    let r = p.baseRadius;
    const step = crownHeight / (p.tiers + 0.6);
    for (let i = 0; i < p.tiers; i++) {
      const h = step * 1.55;
      // Cone with a concave underside: the rim is the lowest point, like drooping branches.
      let cone = k.geo.lathe([[0, h * 0.22], [r, 0], [0, h]], { segments: p.sides, flat: true });
      cone = k.op.jitter(cone, { amount: p.jitter * r, seed: tierRng.int(0, 1e6) });
      cone = k.op.rotate(cone, 0, tierRng.range(0, Math.PI * 2), 0);
      const tier = k.mesh(cone, greens[i % greens.length], { at: [tierRng.jitter(0.04), y, tierRng.jitter(0.04)], rot: [tierRng.jitter(p.lean), 0, tierRng.jitter(p.lean)] });
      crown.add(tier);
      y += step;
      r *= p.tierShrink;
    }
    asset.add(trunk, crown);
    return asset;
  },
});
