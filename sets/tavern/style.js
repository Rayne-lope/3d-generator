// Shared style for the 'tavern' set: Cozy Tavern Props
// Prompt: "Cozy fantasy tavern props: a trestle table, a stool, a wooden mug, a candle holder and a wall shelf"
// Every member imports this module so palette, materials, proportions and edge treatment stay
// consistent across the pack. Change a value here and every member follows.

export const palette = {
  wood: ['#a8693a', '#9a5f33', '#b77744'],
  woodDark: '#6a3f22',
  iron: '#4b4f57',
  wax: '#f1e4c4',
  flame: '#ffb347',
  ale: '#f3e2b0',
};

/** Shared dimensions (meters): human-scale furniture heights and one edge size for the pack. */
export const dims = {
  bevel: 0.012, // chamfer on every wooden edge
  plank: 0.045, // board thickness: chunky, cozy
  seatHeight: 0.45,
  tableHeight: 0.76,
};

/** Shared materials (call once per build). */
export function materials(k) {
  return {
    woods: palette.wood.map((c, i) => k.mat.pbr({ name: `tavern_wood_${i + 1}`, color: c, roughness: 0.75 })),
    woodDark: k.mat.pbr({ name: 'tavern_wood_dark', color: palette.woodDark, roughness: 0.8 }),
    // Painted iron (non-metal): reads the same in every engine without reflections.
    iron: k.mat.pbr({ name: 'tavern_iron', color: palette.iron, roughness: 0.5 }),
    wax: k.mat.pbr({ name: 'tavern_wax', color: palette.wax, roughness: 0.55 }),
    flame: k.mat.pbr({ name: 'tavern_flame', color: '#7a4a1a', emissive: palette.flame, emissiveIntensity: 1 }),
    ale: k.mat.pbr({ name: 'tavern_ale_foam', color: palette.ale, roughness: 0.7 }),
  };
}

/**
 * A board made of `count` planks side by side (table tops, shelves, seats).
 * Planks run along X; the board is centered on the origin with its top at y = 0.
 */
export function planks(k, m, { width, depth, count, thickness = dims.plank, gap = 0.006, seed = 1 }) {
  const g = k.group('planks');
  const rng = k.rng(seed);
  const pw = (depth - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) {
    const z = -depth / 2 + pw / 2 + i * (pw + gap);
    const plank = k.geo.plank(width + rng.jitter(0.01), thickness, pw, { seed: rng.int(0, 1e6), bevel: dims.bevel * 0.8, warp: 0.006 });
    g.add(k.mesh(plank, m.woods[rng.int(0, m.woods.length - 1)], { at: [rng.jitter(0.006), -thickness / 2, z] }));
  }
  return g;
}

export default { palette, dims, materials, planks };
