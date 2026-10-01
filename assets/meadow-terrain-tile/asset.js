// Meadow Terrain Tile
// Prompt: "Stylized meadow terrain tile with a small cliff, a dirt path and some rocks"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Meadow Terrain Tile',
    prompt: 'Stylized meadow terrain tile with a small cliff, a dirt path and some rocks',
    interpretation: '8 × 8 m diorama tile: gentle noise hills with a terraced 1.5 m cliff along the back, a flattened dirt path curving across the front, faceted rocks and a few grass tufts scattered by slope, and soil skirt sides so the tile reads as a solid block. Flat colors by slope/height (grass, cliff rock, path dirt), faceted low-poly shading.',
    style: ['stylized', 'low-poly'],
    category: 'environment',
    budget: { triangles: 9000 },
  },
  seed: 2024,
  params: {
    size: 8,
    segments: 40,
    hillHeight: 0.6,
    cliffHeight: 1.5,
    rocks: 9,
    tufts: 26,
    grass: '#6fa548',
    grassDark: '#5a8f3c',
    cliff: '#8a8478',
    dirt: '#a8865a',
    soil: '#6b5038',
  },
  variants: {
    autumn: { grass: '#b9973f', grassDark: '#a37a33', seed: 77 },
  },
  build({ p, k, rng }) {
    const asset = k.asset('meadow_tile');
    const S = p.size;
    // Path: a smooth curve across the tile (world x → z).
    const pathZ = (x) => 1.2 + Math.sin(x * 0.55) * 0.9;
    const smooth = (e0, e1, x) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const t = k.geo.terrain({
      size: S,
      segments: p.segments,
      skirt: 0.6,
      shading: 'flat',
      height: (x, z, { noise }) => {
        let h = (noise.fbm2(x * 0.22 + 3.1, z * 0.22 + 7.7, { octaves: 4 }) * 0.5 + 0.5) * p.hillHeight;
        // Terraced cliff rising toward the back (-z); its edge wanders with noise.
        const edge = noise.fbm2(x * 0.35 + 11, 4.2, { octaves: 3 }) * 0.6;
        const c = smooth(-1.0 + edge, -2.0 + edge, z) * p.cliffHeight;
        h += Math.round(c / 0.5) * 0.5 * 0.85 + c * 0.15;
        // Flatten along the path.
        const dz = Math.abs(z - pathZ(x));
        const w = 1 - smooth(0.45, 0.9, dz);
        return h * (1 - w * 0.85) + 0.05 * w;
      },
    });
    const mats = {
      grass: k.mat.pbr({ name: 'grass', color: p.grass, roughness: 0.9 }),
      grassDark: k.mat.pbr({ name: 'grass_dark', color: p.grassDark, roughness: 0.9 }),
      cliff: k.mat.physical('stone', { name: 'cliff', color: p.cliff }),
      dirt: k.mat.pbr({ name: 'dirt', color: p.dirt, roughness: 0.95 }),
      soil: k.mat.pbr({ name: 'soil', color: p.soil, roughness: 0.95 }),
    };
    const ground = k.part('ground');
    const patches = k.noise(rng.stream('patches').int(0, 1e6));
    const pieces = t.split((f) => {
      const dz = Math.abs(f.z - pathZ(f.x));
      if (dz < 0.55 && f.faceSlope < 25) return 'dirt';
      if (f.faceSlope > 32 && dz > 1.0) return 'cliff';
      return patches.fbm2(f.x * 0.45, f.z * 0.45, { octaves: 3 }) > 0.18 ? 'grassDark' : 'grass';
    });
    for (const [key, g] of Object.entries(pieces)) ground.add(k.mesh(g, mats[key]));
    ground.add(k.mesh(t.sides, mats.soil, { name: 'skirt' }));

    // Rocks: on flat-ish ground, away from the path.
    const props = k.part('props');
    const spots = t.scatter({ count: p.rocks, seed: rng.stream('rocks').int(0, 1e6), slope: [0, 28], minDistance: 1.0, margin: 0.5, avoid: [{ at: [0, pathZ(0)], radius: 0.6 }] })
      .filter((s) => Math.abs(s.z - pathZ(s.x)) > 0.8);
    const rr = rng.stream('rock-shapes');
    for (const s of spots) {
      const r = rr.range(0.12, 0.32);
      props.add(k.mesh(k.geo.rock(r, { seed: rr.int(0, 1e6), detail: 1, roughness: 0.35 }), mats.cliff, { at: [s.x, s.y + r * 0.35, s.z], rot: [0, rr.range(0, 6.28), 0] }));
    }
    // Grass tufts: small faceted cones on gentle slopes.
    const tuftSpots = t.scatter({ count: p.tufts, seed: rng.stream('tufts').int(0, 1e6), slope: [0, 20], minDistance: 0.4, margin: 0.3 })
      .filter((s) => Math.abs(s.z - pathZ(s.x)) > 0.7);
    const tr = rng.stream('tuft-shapes');
    for (const s of tuftSpots) {
      const g = k.group('tuft');
      for (let i = 0; i < 3; i++) {
        const h = tr.range(0.14, 0.26);
        g.add(k.mesh(k.geo.cone(0.035, h, { segments: 4, base: true, flat: true }), mats.grassDark, { at: [tr.jitter(0.05), 0, tr.jitter(0.05)], rot: [tr.jitter(0.35), 0, tr.jitter(0.35)] }));
      }
      g.position.set(s.x, s.y - 0.01, s.z);
      props.add(g);
    }
    asset.add(ground, props);
    return asset;
  },
});
