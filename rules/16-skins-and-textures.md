# 16 — Skins and 3D-painted textures

A **skin** is another look on the exact same mesh: desert camo, gold plating, neon. Engines can
swap skins on one model (Roblox SurfaceAppearance, glTF `KHR_materials_variants`, material
overrides), so a skin may change the surface and nothing else.

## 1. Skins vs variants

| | Variant (`variants`) | Skin (`skins`) |
| --- | --- | --- |
| May change | anything: size, parts, seed, materials | surface params only: colors, patterns, finishes, wear |
| Checked | like any item | against the default look: same nodes, triangles, normals, UVs and material slots |
| Item id | `slug--variant` | `slug@skin` (also `slug--variant@skin`) |
| Engine use | separate model | same model, swapped textures |

The default params are the default look (`default`). Every skin is a set of param overrides:
`skins: { desert: { coat: 'camo', coatColors: [...] } }`. Skins cannot change the seed.
A skin that changes the mesh fails with `skin.geometry-changed`; one that changes the material
list or a material's maps fails with `skin.materials-changed` (fixes in rule 07).

## 2. Build an asset that can take skins

1. **Unique UVs for the skinnable zones.** Merge each zone's pieces, `k.uv.unwrap` it, then pack
   all zones into one atlas: `k.uv.atlas(entries, { size: 1024, padding: 12 })`. UV code must not
   depend on skin params.
2. **One material, one atlas** for the whole asset when possible. Finishes (metal, wood, paint)
   live in the color and ORM maps per zone, so a skin can repaint a zone without touching the
   material list.
3. **Bake the surface once:**
   `const bake = k.bake.surface(entries).edges({ angle: 25, width: 0.0035 }).ao({ distance: 0.03 })`.
   Bakes are cached by content, so all skins of a model share the work.
4. **Paint in 3D** with `painter.paint3d(bake, (p) => [r, g, b])`. `p.pos` is the 3D point in
   meters, `p.entry` the atlas entry (use it to pick the zone), `p.edge` / `p.cavity` / `p.ao` the
   baked masks. Patterns from `k.tex.pattern` are functions of the 3D position, so they continue
   across UV seams and from part to part (author meshes in asset space, as the kit expects).
5. **Shared detail:** rivets, grooves and stamping go into a height map that depends only on
   geometry, turned into the normal map. Every skin then has the same normal map, which packs and
   Roblox uploads store once.
6. **Same maps in every look.** A material that has a color + ORM + normal map keeps all three in
   every skin. A material cannot be flat in one skin and textured in another (the Roblox palette
   atlas would move its UVs).

## 3. Designing good skins

- **Scale patterns to the object:** camo blobs 5–10 % of the object's length (0.05–0.08 m on a
  0.9 m rifle), digital pixels 0.6–1 % (7–10 mm), stripe spacing 3–4 %. Blobs as big as a part
  read as flat color; tiny ones turn to noise at a distance.
- **Value contrast:** 3–4 colors spread from light to dark. Colors of the same value merge into
  mush from a distance; check the skin sheet at thumbnail size.
- **Keep the function readable:** barrels, bores, sights and moving metal stay metal unless the
  skin is a full plating (gold, chrome). Coated zones and bare metal should contrast.
- **Wear reveals the layer below:** paint over metal chips to bare steel, paint over wood shows
  wood, plating wears to a brighter metal. Same wear mask in every skin (fixed noise seeds), so
  looks differ only in finish.
- **Finish roughness:** matte paint 0.55–0.7, gloss 0.25–0.35, metal plating 0.12–0.3, rubberized
  0.8+. Plated metals need low roughness to show reflections.
- **Neon without emissive:** saturated lines on near-black. Roblox SurfaceAppearance has no
  emissive map, so glow only works through the mesh's default material.
- **Names:** short, lowercase, hyphenated (`desert`, `digital-urban`). They become file names,
  Roblox folder names and viewport chips.

## 4. Patterns (`k.tex.pattern`)

| Pattern | Key options | Notes |
| --- | --- | --- |
| `camo` | `colors` (ground first), `scale`, `coverage`, `warp` | woodland, desert, arctic… are color choices |
| `digital` | `colors`, `cell`, `scale` | camo sampled on `cell`-sized cubes: square pixels on every face |
| `tiger` | `colors` (ground, blotch, stripe), `spacing`, `width`, `axis` | broken brush-stroke stripes |
| `hex` | `colors` (fill, line, accent), `size`, `line`, `accent` | projected per face like a decal |
| `carbon` | `colors`, `size` | 2×2 twill, projected per face |
| `brushed` | `color`, `axis`, `amount`, `scale` | metal streaks along an axis |

Discrete patterns also give `.index(p)` (which color), useful for per-layer roughness.

## 5. Review and delivery

- `node studio review <slug> --skins` renders every look and writes the skin sheet
  (`.studio/shots/<slug>/<profile>/skins.png`, same cameras for every look).
- `node studio export <slug> --skins --profile <p>` exports every look and the skin pack:
  maps per look + `skins.json`; Roblox adds SurfaceAppearance maps (separate metalness and
  roughness) and `SkinSwitcher.lua`; generic adds `<slug>.skins.glb` with every look as
  `KHR_materials_variants`.
- `node studio publish <slug> --roblox --skins` uploads the maps as Images and writes
  `exports/roblox/<slug>.skins.rbxmx` (premade SurfaceAppearances + SkinSwitcher).
