# 07 — Export hygiene

What leaves the studio must look the same in the engine as in the viewport. The viewport
already shows the exported file (Preview = Export); the validator guards the rest.

## What is exported

Geometry (positions, normals, one UV set, MikkTSpace tangents when normal-mapped), glTF PBR
materials, PNG textures, the node hierarchy of separate parts. Never exported: grid, lights,
cameras, helpers, the human reference, viewport tricks.

## Engine profiles

| | generic | godot | roblox |
| --- | --- | --- | --- |
| Units in file | meters | meters | studs (pre-scaled ×25/7) |
| Colors | material factors | material factors | baked into textures (palette for flat colors) |
| Meshes | one per part | one per part | one per material per part (MeshParts) |
| UVs | any | any | 0..1 (repeats baked into images) |
| Textures | ≤ 4096 | ≤ 4096 | ≤ 1024, power of two |
| Triangles / mesh | — | — | ≤ 20,000 (auto-split), warn > 10,000 |

`node studio build <slug> --profile roblox` previews the Roblox file; the viewport profile
switcher shows exactly that file.

## Workflow

1. `node studio review <slug>` → fix every error; justify or fix warnings.
2. `node studio export <slug> --profile <generic|godot|roblox|all>` → blocked by any error.
3. Read the export report (`exports/<profile>/<slug>.report.md`): dimensions, triangles,
   textures, conversions and import hints.

## Fix guide by issue id

| Id | Meaning | Fix |
| --- | --- | --- |
| `geometry.inverted-faces` | Winding disagrees with normals; engines cull those faces | Remove negative scale; use `k.op.mirror`; fix custom triangle order |
| `geometry.inside-out` | A closed shell faces inward | Same as above (usually a mirrored or hand-built mesh) |
| `geometry.duplicate-faces` | Coincident triangles → z-fighting | Make one part slightly smaller/offset by ≥ 2 mm |
| `geometry.degenerate` | Zero-area triangles | Usually harmless; avoid collapsed profile points |
| `geometry.nan` / `bad-normals` | Broken math | Check params for zero/negative sizes; recompute shading |
| `geometry.open-edges` / `non-manifold` | Info | Close shells whose back is visible |
| `uv.missing` | Textured material without UVs | Apply `k.uv.box/planar/cylindrical` |
| `uv.out-of-range` | UVs outside 0..1 on Roblox that could not be tile-baked | Use a repeating texture (not atlas) or fewer repeats |
| `uv.padding` | Atlas islands too close at final resolution | Repack with larger `padding`, or more texture resolution |
| `uv.overlap` | Atlas islands overlap | Unique UVs via `k.uv.unwrap` + `k.uv.atlas` |
| `uv.stretch` / `uv.degenerate` | Uneven or collapsed UVs | Use world-scale projections matching the surface |
| `texture.low-density` | Too few texels per meter → blurry | Fewer repeats, split the surface, flat colors for big areas |
| `texture.density-mismatch` | Parts unevenly sharp | Align `scale` of UV projections / texture sizes |
| `texture.too-large` / `large` / `non-power-of-two` | Size issues | Author 256/512/1024 power-of-two textures |
| `texture.memory` | Too many megapixels | Share textures, lower resolution on small parts |
| `scene.mesh-triangles` | Mesh over the engine limit | Fewer segments, drop hidden faces, split parts |
| `scene.triangle-budget` | Over `meta.budget` | Reduce detail on small/hidden features first |
| `scene.origin` | Origin not where `meta.origin` says | Use the default origin handling; don't move the root |
| `scene.dimensions` | Size unusual for the category | Check units (meters) and the reference table in 02 |
| `scene.mesh-count` | Many meshes/MeshParts | Merge static parts, share materials |
| `material.alpha-mode` | Alpha mode not portable for the profile | Prefer opaque or mask |
| `material.metallic-midrange` | Metalness between 0 and 1 | Use 0 or 1; vary through textures |
| `material.albedo-range` | Base color nearly black/white | Keep 30–240 sRGB for non-metals |
| `material.needs-reflections` | Polished metal depends on environment | Roughness ≥ 0.35, or painted metal (metalness 0) for stylized |
| `material.emissive` | Emissive unverified on the engine | Keep a meaningful base color; check in-engine |
| `source.random` / `source.time` | Non-deterministic build | Use `rng.stream(name)`; remove clocks |
| `source.node-api` / `dynamic-load` | Asset code not portable | Only use the kit inside `build()` |
| `source.material` / `source.side` | Non-portable material/sidedness | `k.mat.pbr`; model thickness |
| `parity.mismatch` | Source and exported GLB render differently | Open the parity images (source / GLB / diff) and remove the non-exportable feature |
| `export.nondeterministic` | A fresh build does not reproduce the preview bytes | Randomness only from `rng`/`noise`; no clocks; don't iterate objects whose order can change |
| `scene.empty` | No triangles in the GLB | `build()` must add meshes to the `k.asset()` root and return it |
| `scene.triangles-total` | Many triangles for the whole asset on this engine | Lower segments on small parts; split big environment pieces into tiles |
| `scene.materials-per-mesh` | A mesh has more materials than the engine allows | Normally handled by the profile (split / palette); merge similar materials |
| `scene.node-scale` | A node has scale left after baking | Don't scale separate parts' roots; scale geometry instead |
| `material.double-sided` | Double-sided materials are not portable | Model thickness, or add a back face with `k.op.flipWinding` |
| `material.emissive-strength` | Emissive intensity > 1 needs an extension the engine ignores | Keep `emissiveIntensity` ≤ 1 for Roblox; brighten the emissive color instead |
| `texture.density-below-target` | Sharpness below the profile's target (above its minimum) | Fine for secondary parts; raise resolution or reduce repeats on hero surfaces |
| `khronos.*` | glTF validator finding | Report as a studio bug if it comes from kit-made geometry |
