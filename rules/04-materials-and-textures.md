# 04 — Materials and textures

Only **glTF PBR metallic-roughness** survives export to every engine. The kit enforces it:
`k.mat.pbr()` / `k.mat.physical()` create the only allowed material type.

## PBR values that read correctly

| Property | Rule |
| --- | --- |
| Metalness | **0 or 1.** Bare metal = 1. Paint, rust, wood, stone, plastic, fabric = 0. In-between values only through a texture (scratched paint revealing metal). |
| Base color (non-metal) | Keep roughly **30–240 sRGB** (no pure black or white). Coal ≈ #202020, fresh snow ≈ #e8ecef. |
| Base color (metal) | The metal's reflectance color, bright: iron #8f9396, steel #b4b8bb, gold #f0c45c, copper #d48a63, brass #d8b56a. |
| Roughness | Polished 0.1–0.3, satin 0.35–0.5, worn/painted 0.5–0.7, raw wood/stone/fabric 0.75–0.95. Avoid one roughness for every material. |
| Emissive | For light sources only (flames, screens, glow strips). Keep the base color meaningful without the glow — Roblox emissive import is unverified. |
| Alpha | Prefer **opaque**. Use `mask` (cutout) for leaves/fences; `blend` only when unavoidable (sorting differs per engine; Roblox warns). |

`k.mat.physical(kind, overrides)` gives plausible starting values per material class.

### Metals and lighting

Metallic surfaces show the environment. The neutral viewport has a plain gray ambient (like an
engine's default sky), so metals read, but **polished metal (roughness ≤ 0.3) still depends
on reflections** and the validator warns. Options:
- realistic asset → metalness 1, roughness ≥ 0.35;
- stylized asset → "painted metal": metalness 0 with a lighter gray/bronze color. Consistent in
  every engine and lighting setup.

## Flat colors vs textures

- **Stylized / low-poly / cartoon**: flat colors per material are usually best. The Roblox
  profile merges them into one palette texture (one MeshPart) automatically.
- **Realistic / worn**: bake procedural textures with `k.tex.create()`: base color, a height
  painter → `k.tex.normalFromHeight()`, and roughness/metalness via `k.tex.orm()`.
- Use the **same seed and parameters** for the color and height version of a pattern so the
  normal map lines up with the color (e.g. `grain({ seed: 7 })` in both).

## Texture direction

Painter coordinates: u to the right, **v downward** (row 0 = image top, glTF convention).
`stretch: [1, N]` makes features long along **u**; `stretch: [N, 1]` makes them long along
**v**. Box/planar/cylindrical UVs map "up" on a vertical face to the image top. Check grain and
straw direction on the review sheet and use `k.uv.rotate(g, Math.PI / 2)` for parts whose
grain must run vertically (posts, legs, battens).

## Texel density (sharpness)

Texel density = texels per meter on the model. Keep it **consistent across one asset** and
high enough for the engine:

| Profile | Minimum | Target |
| --- | --- | --- |
| generic / godot | 128 px/m | 256 px/m |
| roblox | 90 px/m | 180 px/m |

- World-scale UVs (`k.uv.box(g, { scale })`, scale = repeats per meter) keep density uniform
  automatically: a 512 px tiling texture at `scale: 1` = 512 px/m.
- Roblox needs UVs inside 0..1, so the exporter **bakes repeats into the image** and then caps
  it at 1024 px. Big surfaces with many repeats lose density: the validator reports the
  resulting px/m and blocks the export below 90 px/m. Fixes: fewer repeats (bigger tiles),
  split the surface into several meshes/materials, or use flat colors for large areas.
- Avoid density mismatches above 3× between parts (validator warns).

## UV islands and padding (atlas textures)

Tiling textures overlap and repeat on purpose — padding doesn't apply. Atlas textures (unique
UVs, `layout: 'atlas'`) need **gutters** between islands so mipmaps and engine downscaling
don't bleed neighboring colors:

- Use `k.uv.unwrap(g)` for each part, then `k.uv.atlas({ name: geometry, ... }, { size, padding })`.
- Required padding at the final export size: **4 px** (generic/godot), **8 px** (Roblox).
  Pack with `padding: 8`–`16` to be safe — the validator measures the real gutter.
- Paint into each island with `tex.clip(layout.rect('name', '+z'), (t) => ...)` (local UVs
  0..1 inside the rect).
- The exporter dilates island edge colors into the gutters automatically.
- Overlapping islands on an atlas show the same pixels twice (validator warns).

## Color space and sizes

- Base color and emissive painters are `space: 'srgb'` (default); normal, ORM and height are
  `space: 'linear'`. The kit refuses mismatches.
- Normal maps are OpenGL convention (+Y up) — what `normalFromHeight` produces and what glTF,
  Godot and Roblox expect.
- Texture sizes: powers of two (256, 512, 1024). Roblox caps at 1024; anything larger is
  resized and the preview shows the result.
