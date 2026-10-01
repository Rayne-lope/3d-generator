# 03 — Detail hierarchy

Detail should guide the eye, not cover everything evenly.

## Distribute detail 70 / 20 / 10

- ~70 % of the surface is **rest area**: calm, readable, mostly one material.
- ~20 % carries **secondary detail**: bands, trims, panel seams, handles.
- ~10 % is **focal detail**: the lock on a chest, the gauge on a valve, the lantern on a lamp.
  Put the most contrast (color, shape, glow) here.

If everything is detailed, nothing is. Remove detail from areas the player rarely sees
(undersides, backs against walls) before adding it elsewhere.

## Model it or paint it?

| Model (geometry) | Paint (texture/normal map) |
| --- | --- |
| Changes the silhouette | Flat or shallow (< 1 cm on a prop) |
| Casts visible shadow / self-occlusion | Many repeated tiny features (grain, scratches, rivet rows on large panels) |
| Seen up close and at angles | Wear, dirt, stains, color variation |
| Moves or must collide | Engine budget is tight (Roblox 10–20k triangles per mesh) |

Medium features (planks, hoops, bevels, panel insets) are usually geometry; micro features
(grain, pores, scratches) are textures.

## Edges and wear

- Bevel hard edges (see 01). Larger bevels = softer, more stylized.
- **Wear goes where things touch**: edges, corners, handles, the bottom 10–20 cm (dirt,
  rust, chipped paint), top surfaces (dust). Use `dirt({ from: 'bottom' })`, `scratches`,
  `rust`, `edges` on textures; dents (`k.op.dent`) and missing pieces on geometry.
- Damage tells a story: a broken stave, a dropped hoop, a dented corner. One or two strong
  damage features beat uniform noise everywhere.

## Contrast

Separate parts by **value** (light/dark) first, then hue. Dark iron bands on light wood, gold
trim on dark wood, cyan glow on off-white shells. Neighboring parts with the same value merge
into one blob from a distance.
