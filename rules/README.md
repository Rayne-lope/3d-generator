# Modeling rules

Quality knowledge for the agent that writes asset code. Read the files that match the job
before writing `build()`; re-read the review checklist before every `node studio save`.

## Precedence

1. **The prompt decides art direction**: style, shape, proportions, palette, mood, level of
   detail, realism vs. stylization. If the prompt says "tiny oversized-head mushroom house",
   that wins over any real-world dimension table here.
2. **These rules decide craft and technical correctness**: readable silhouettes, clean
   shading, sensible density, structure, efficiency, and everything that must survive export.
   They never impose a style.
3. **Engine limits are hard**: the validator blocks exports that would break or degrade in the
   target engine. Never work around an error by weakening a check.

When the prompt is ambiguous, state your interpretation in one or two sentences, build a fast
first version, and let revisions refine it.

## Files

| File | Use it when |
| --- | --- |
| [01-shape-and-silhouette.md](01-shape-and-silhouette.md) | Always — first pass of any asset |
| [02-proportion-and-scale.md](02-proportion-and-scale.md) | Picking sizes; anything people use or walk through |
| [03-detail-hierarchy.md](03-detail-hierarchy.md) | Deciding what to model vs. paint, bevels, wear |
| [04-materials-and-textures.md](04-materials-and-textures.md) | Any material choice; any texture, UV or atlas work |
| [05-topology-and-efficiency.md](05-topology-and-efficiency.md) | Segment counts, triangle budgets, hidden faces |
| [06-structure-parts-pivots.md](06-structure-parts-pivots.md) | Parts, moving pieces, origins, params, seeds |
| [07-export-hygiene.md](07-export-hygiene.md) | Before export; fixing any validator issue id |
| [08-style-recipes.md](08-style-recipes.md) | Translating style words into techniques |
| [09-sets-and-variants.md](09-sets-and-variants.md) | Packs from one prompt; variations of one asset |
| [10-revisions.md](10-revisions.md) | Every follow-up prompt on an existing asset |
| [11-limitations.md](11-limitations.md) | Organic shapes, characters, anything outside our strengths |
| [12-environments-and-terrain.md](12-environments-and-terrain.md) | Terrain tiles, cliffs, paths, dioramas, scattering |
| [13-buildings-and-houses.md](13-buildings-and-houses.md) | Houses, walls, roofs, doors, windows, modular kits; whole buildings up to manors with `k.arch.building`; building from a house photo |
| [14-nature-rocks-vegetation.md](14-nature-rocks-vegetation.md) | Rocks, trees, bushes, grass, crystals |
| [15-weapons.md](15-weapons.md) | Guns, melee weapons, bows, shields: game-ready weapon props |
| [16-skins-and-textures.md](16-skins-and-textures.md) | Skins (many looks on one mesh), 3D-painted atlas textures, patterns, wear |
| [17-complex-shapes.md](17-complex-shapes.md) | Anything beyond boxes and cylinders: sci-fi hard surface, vehicles, gadgets, smooth product shapes; tracing a reference image |
| [checklists/review.md](checklists/review.md) | After every `node studio review` |

The kit API itself is documented in [docs/KIT.md](../docs/KIT.md).
