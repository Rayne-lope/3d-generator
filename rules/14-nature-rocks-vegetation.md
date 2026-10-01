# 14 — Nature: rocks, trees, plants (core essentials)

Nature is irregular but not random. Big shapes stay simple and readable; variation comes from
seeds, scale and small tilts.

## Rocks

```js
k.geo.rock(r, { detail: 1|2, roughness: 0.25–0.4, squash: [1.2, 0.6, 1], seed, flat: true })
```

- Flatten the bottom and sink 30–40 % into the ground; rocks never balance on a point.
- Squash them (wider than tall) for boulders; tall thin rocks for spires/cliff shards.
- **Sets beat singles**: seed variants (`a/b/c`) and size ratios 1 : 0.5 : 0.25 in clusters.
- Moss/snow on upward faces: split faces by height or normal (`k.op.keepFaces` on the centroid,
  or `terrain.split` on terrain) into a second material.
- Low-poly: detail 1, faceted; realistic: detail 2–3, crease shading, stone texture + normal map.

## Trees

- Silhouette first: conifer = stacked cones; broadleaf = trunk + 3–7 clustered blobs
  (icospheres) slightly overlapping; palm = curved trunk (`k.geo.tube`) + leaf cards (mask) or
  extruded leaf shapes.
- Trunk: taper (`radiusTop` 60–75 % of base), slight lean or bend (`k.op.bend`), root flare.
- Tiers/blobs: random rotation per tier, small tilt (±0.05–0.1 rad), jitter vertices for
  low-poly.
- Colors: 2–3 greens of the same hue family, darker at the bottom/inside, lighter at the top.
- Heights: young 3–6 m, mature 10–25 m; stylized trees are often 3–6 m regardless.
- Variants by seed + height/radius params give a forest from one asset.

## Bushes, grass, flowers

- Bushes: 3–6 overlapping icospheres (detail 1), squashed, one or two greens.
- Grass tufts: 3–5 thin cones/blades leaning outward; scatter many small tufts rather than a
  few big ones.
- Flowers: stem (thin cylinder) + head (small disc/sphere/star extrusion) in an accent color;
  use sparingly as focal color.
- Leaves and grass cards with alpha: use `alpha: 'mask'`, never `blend`; remember single-sided
  rendering — give cards a back face (duplicate with `k.op.flipWinding`) or use solid blades.

## Crystals and minerals

Hexagonal prisms with pointed tips (`k.geo.lathe([[0,0],[r,0],[r*0.9,h*0.8],[0,h]], { segments: 6, flat: true })`),
fanned outward from a base rock, one dominant crystal plus smaller ones, glow through emissive.

## Placement on terrain

Use `terrain.scatter({ slope, heightRange, minDistance, avoid })`; trees on gentle slopes, rocks
at cliff bottoms and on flats, nothing on paths. Cluster by type; leave clearings.

## Budget

Rock 50–800 triangles, low-poly tree 60–400, stylized tree 400–2,000, bush 100–600, grass tuft
10–60. Scatter adds up — count instances × triangles against the tile budget.
