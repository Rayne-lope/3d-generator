# 05 — Topology and efficiency

Triangles cost memory and draw time, and Roblox rejects meshes above 20,000 triangles. Spend
them where the silhouette needs them.

## Budgets (set `meta.budget.triangles`)

| Asset | Low-poly / mobile | Standard prop | Hero / detailed |
| --- | --- | --- | --- |
| Small prop (mug, bottle, tool) | 100–500 | 500–2,000 | 2,000–5,000 |
| Medium prop (barrel, crate, chair) | 300–1,500 | 1,500–6,000 | 6,000–15,000 |
| Large prop / furniture set piece | 1,000–3,000 | 3,000–10,000 | 10,000–25,000 |
| Building / terrain tile | 2,000–6,000 | 6,000–15,000 | 15,000–40,000 |

Roblox: ≤ 20,000 per mesh (hard), aim for ≤ 10,000 per mesh on mobile. The exporter splits
oversized meshes into connected pieces automatically; a single piece above the limit fails
unless exported with `--allow-decimate`.

## Segment counts

| Feature | Segments around |
| --- | --- |
| Large round body (barrel, drum, tower) | 24–40 |
| Medium cylinder (post, pipe, leg) | 12–20 |
| Small cylinder (bolt, rung, wick) | 6–8 |
| Tiny detail (rivet head) | icosphere detail 0, or 6 sides |
| Torus ring | radial 6–10 × tubular 24–40 |

Rule of thumb: add segments until the silhouette edge looks smooth in the review sheet, not
beyond. Faceting on the *inside* of a shape is invisible; on the outline it is obvious.

## Clean geometry

- **No hidden faces** where it matters for budget: faces fully inside other parts or against a
  wall can be dropped (`k.op.keepFaces`). Overlapping solids are fine visually but cost
  triangles.
- **No coplanar overlaps**: two surfaces in the same plane flicker (z-fighting). Offset
  decals/plates by ≥ 2 mm or make one part slightly smaller (validator: `geometry.duplicate-faces`).
- **Thickness everywhere visible**: single-sided planes vanish from behind in engines (no
  double-sided materials). Use thin boxes, washers or closed lathes. Single-sided planes are
  acceptable only where the back is never visible (a dial behind glass, a floor top).
- **Shading**: `flat` for faceted low-poly; `crease(angle)` for everything else (smooth curves,
  sharp corners); `smooth` for organic blobs. Bevels plus crease shading give the clean look.
- **Mirror safely**: `k.op.mirror(g, 'x')` fixes winding. Never use negative scale — engines
  render those faces inside out (validator: `geometry.inverted-faces`).
- CSG (`k.csg.subtract`) is great for holes and slots but creates slivers; for wall openings use
  `k.arch.wall({ openings })`.

## Draw calls

Every material in a mesh is a draw call (and on Roblox a separate MeshPart). Share materials
across parts, reuse one wood material for all planks with a few tone variants at most, and merge
static parts (the default; only `separate: true` parts become their own node).
