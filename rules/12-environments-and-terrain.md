# 12 — Environments and terrain (core essentials)

Build environment **pieces** that drop into an engine level: terrain tiles and dioramas,
cliff modules, paths, rock and tree sets, modular walls. Large open landscapes belong in the
engine's terrain system; your pieces dress them.

## 1. Pick the piece and its scale

| Piece | Typical size | Notes |
| --- | --- | --- |
| Diorama / showcase tile | 6–10 m square | Closed block with `skirt` sides |
| Snap-together ground tile | 4, 8 or 16 m (Roblox: 16/32/64 studs) | Edges must match: keep border height constant (`edge`) |
| Cliff module | 4–8 m wide, 2–6 m tall | Flat back and sides so modules can line up |
| Rock / boulder set | 0.2–3 m | Variants via seeds (see 14) |
| Path / road piece | 2–4 m wide | Flattened strip, slightly sunken |

State the size in `meta.interpretation`.

## 2. Height: layer simple ideas

```js
const t = k.geo.terrain({
  size: 8, segments: 40, skirt: 0.6, shading: 'flat',
  height: (x, z, { noise }) => {
    let h = (noise.fbm2(x * 0.22, z * 0.22, { octaves: 4 }) * 0.5 + 0.5) * 0.6;   // rolling hills
    h += smooth(-1.0, -2.0, z) * 1.5;                                              // a cliff rising to the back
    h *= 1 - pathMask(x, z) * 0.85;                                                // flatten the path
    return h;
  },
});
```

- **Base form first**: one or two big ideas (a rise, a cliff, a basin) read better than uniform
  noise. Noise is seasoning: amplitude 0.2–0.6 m on an 8 m tile.
- **Frequency**: features of 3–6 m on a tile (`scale` 0.15–0.3). High-frequency noise on
  terrain looks like crumpled paper.
- **Terraces** (`terrace: { step }` or quantizing a term) give stylized ledges; wiggle the cliff
  edge with low-frequency noise so it isn't a ruler-straight line.
- **Flatten pads** for buildings and paths (`flatten: [{ at, radius, height }]` or your own mask).
  Buildings need level ground; paths need gentle cross-slope.
- **Edges that tile**: use `edge: { falloff, height }` so every border ends at the same height,
  or keep the height function periodic. Diorama tiles instead get a `skirt` (soil sides + bottom).

## 3. Surface: classify by slope and height

```js
const pieces = t.split((f) => {
  if (pathDistance(f.x, f.z) < 0.55 && f.faceSlope < 25) return 'dirt';
  if (f.faceSlope > 32 && pathDistance(f.x, f.z) > 1.0) return 'cliff';
  return patches.fbm2(f.x * 0.45, f.z * 0.45) > 0.18 ? 'grassDark' : 'grass';
});
for (const [key, g] of Object.entries(pieces)) ground.add(k.mesh(g, mats[key]));
```

- **Slope decides rock vs. ground**: > 30–35° is rock/cliff, < 25° can hold grass, paths and
  props. Height bands add sand near water, snow on peaks.
- Use **low-frequency noise patches** for color variation (two grass tones), not per-face
  randomness (which reads as checkerboard noise).
- Stylized: flat colors per class (the Roblox profile palettes them into one MeshPart).
  Realistic: `uv: 'fit'` + `t.paint(painter, fn)` bakes one texture by slope/height — keep tiles
  small enough for the profile's texel density (Roblox: ≤ ~8 m per 1024 px texture).

## 4. Dress it: scatter with rules

```js
const spots = t.scatter({ count: 9, seed, slope: [0, 28], minDistance: 1.0, margin: 0.5, avoid: [{ at: [0, 1.2], radius: 0.8 }] });
for (const s of spots) props.add(k.mesh(k.geo.rock(r, { seed: rr.int(0, 1e6) }), stone, { at: [s.x, s.y + r * 0.35, s.z] }));
```

- Scatter **by slope** (rocks on flats and at cliff feet, grass on gentle slopes), keep paths
  clear, keep a margin from tile borders so pieces tile.
- **Cluster**: big rock + 2–3 small ones reads natural; evenly spaced props read artificial.
- Sink props slightly into the ground (rocks 30–40 % of their radius) so they never float.
- Size variety: few large, more medium, many small.

## 5. Composition (small dioramas)

- One **focal point** (a cliff with a cave, a tree, a ruin) and a **path** leading the eye to it.
- Vary height: something low, something mid, something tall.
- Leave calm areas; don't fill every square meter.

## 6. Budgets and engines

- Tile density: 0.15–0.25 m per cell (8 m tile → 32–50 segments → 2–5k triangles).
- Roblox: ≤ 20k triangles per mesh (auto-split), textures ≤ 1024. For big areas prefer flat
  colors or several smaller tiles over one huge textured mesh.
- Godot: no hard limits, but keep tiles chunked (≤ 64 × 64 m) for culling.
- Closed `skirt` sides prevent see-through gaps when tiles are viewed from the side.
