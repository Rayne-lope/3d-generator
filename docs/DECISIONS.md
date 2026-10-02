# Decisions

This file answers the PRD's open questions and records the technical decisions behind the
studio, with the research they are based on (October 2026). Anything marked **unverified**
needs one check in the real engine: see `engines/roblox/CHECKLIST.md` (Godot is verified
automatically by `node studio engine-verify godot`).

## PRD open questions

| Question | Decision |
| --- | --- |
| Are Godot and Roblox Studio enough as initial engines, or do Unity/Unreal join? | **Godot 4 and Roblox Studio**, plus a **Generic glTF** profile. Unity (glTFast) and Unreal (Interchange) can import the generic GLB today without parity guarantees; each becomes a full engine profile later (see GUIDE → "Adding an engine profile"). |
| Can GLB be imported directly into Roblox Studio, or is FBX/OBJ conversion needed? | **Direct.** The Roblox Importer (File → Import 3D) supports glTF/GLB natively (beta 2023, full release since). No conversion path is needed. Importer limitations are handled by the `roblox` profile (below). |
| Must an asset be one mesh, or may it have separate parts? | **Flexible multi-part.** By default everything is merged per material into one `body` mesh (efficient). Parts that move or detach (lids, doors, wheels, drawers) are declared with `k.part(name, { separate: true, pivot })` and become their own glTF node with their pivot. On Roblox each material becomes a MeshPart; flat colors are merged through a palette texture so they stay one MeshPart. |
| How many versions per asset are kept for undo? | **The last 20 versions plus every pinned version** (`node studio pin`). Configurable in `studio.config.json` → `history.keep`. |

## How assets are made

- The AI coding agent writes **procedural Three.js code** in `assets/<slug>/asset.js` using the studio kit (`studio/kit`). No Blender, no cloud generation.
- Asset modules export `defineAsset({ meta, seed, params, variants, build })`. `params` hold every revisable number; `variants` are named param/seed overrides exported as separate GLBs; sets (packs) share `sets/<set>/style.js`.
- Builds are **deterministic**: seeded RNG with named streams per part, no clocks, no `Math.random`. A revision only changes what it touches.
- The browser is **only a viewport**. It loads the exported GLB through a plain `GLTFLoader` (**Preview = Export**). Build, validation and export run in Node (`node studio …`).

## Export pipeline

- `three.js scene → IR → engine profile transforms → glTF-Transform → GLB`. The IR rejects anything glTF or our parity rules cannot represent (non-PBR materials, double-sided, vertex colors, texture transforms, points/lines, skinning) with a fix hint.
- Only **glTF PBR metallic-roughness**. Procedural textures are baked by a pure-JS painter (identical in Node and the browser) into **PNG** (lossless). No Draco, meshopt, quantization or JPEG.
- **MikkTSpace tangents** are written whenever a normal map is used, so normal maps decode the same in every engine.
- Units: **1 unit = 1 meter**, **+Y up**, **asset front faces +Z**, origin at **base center** by default (`meta.origin` can change it). Base center means the lowest point at y = 0 and x/z at the center of the **footprint** (the vertices in a thin band above the lowest point), not of the whole bounding box. A revision that grows a protruding detail (a bigger lock, a longer branch) therefore does not shift the asset in a level after re-import.
- glTF-Transform's `prune()` would delete solid-color textures (it folds them into factors); the studio keeps them (`keepSolidTextures`) because Roblox needs colors in textures.

## Engine profiles

| | generic | godot | roblox |
| --- | --- | --- | --- |
| Units | meters | meters | **studs** (×25/7) |
| Triangles per mesh | warn > 100k | warn > 100k | **error > 20,000** (auto-split by connected pieces), warn > 10k |
| Max texture | 4096 (warn > 2048) | 4096 (warn > 2048) | **1024** |
| Materials per mesh | many | many | **1** (split into MeshParts; flat colors → palette atlas) |
| Color/metal/rough factors | kept | kept | **baked into textures** |
| UV range | any (REPEAT) | any | **0..1** (texture repeats baked into the image; large surfaces cut on the tile grid first) |
| Min UV island padding (atlas textures) | 4 px | 4 px | **8 px at the final size** |
| Texel density min / target | 128 / 256 px/m | 128 / 256 | **90 / 180 px/m** |
| Alpha | all | all | opaque, mask (blend = warning) |

### Roblox research notes

- glTF/GLB import: supported by the Importer (File → Import 3D, or Home/Avatar → Import 3D). ([3D Importer](https://create.roblox.com/docs/art/modeling/3d-importer), [glTF full release announcement](https://devforum.roblox.com/t/3d-importer-gltf-file-support-full-release/2584034))
- `baseColorFactor` is **not preserved** by the glTF importer (reported on the DevForum), so the `roblox` profile bakes every color into a texture. ([bug report](https://devforum.roblox.com/t/3d-importer-gltf-basecolorfactor/4013776))
- One material per MeshPart; multi-material meshes must be split or atlased.
- UVs must be inside 0..1; overlapping UVs are allowed; one UV set; normal maps are OpenGL tangent space (same as glTF). ([Texture specifications](https://create.roblox.com/docs/art/modeling/texture-specifications))
- The Importer rejects meshes above **20,000 triangles**; 10,000 is the conservative target used by many creators for mobile.
- SurfaceAppearance texture maps: up to **1024×1024** (larger images are downscaled), so the profile downscales first — the preview shows exactly what Roblox gets, and the validator flags the resulting texel density.
- Units: the Importer's *Scale Unit* defaults to **Stud**. Since **2026-06-16** non-stud units convert with **25:7 studs per meter** (1 stud = 0.28 m), and a custom scale factor field exists. ([announcement](https://devforum.roblox.com/t/more-control-over-importer-custom-scale-factor-and-updated-unit-conversions/4644371)) **Decision:** the Roblox export is **pre-scaled to studs**, so the default *Scale Unit = Stud* gives the right size with zero configuration. (Switching to meter exports is one line in `studio/profiles/roblox.json` → `units.perMeter: 1`, then import with *Scale Unit = Meter*.)
- **Unverified (needs Roblox Studio, which has no headless mode):** the import itself on the golden set, emissive mapping, alpha-blend behavior and the forward axis after import. `node studio engine-pack roblox` prepares the GLBs, a manifest and a template place with a verify script; `engines/roblox/CHECKLIST.md` is the 15-minute manual run.

### Godot research notes

- Godot 4 imports glTF 2.0 natively (editor import, or runtime `GLTFDocument.append_from_file` + `generate_scene`). Meters, +Y up; models face +Z (`Vector3.MODEL_FRONT`), so no conversion is needed. Latest stable at the time of writing: 4.7.2.
- `baseColorFactor` → `StandardMaterial3D.albedo_color` (converted to sRGB by the importer); metallic-roughness, normal (with tangents), occlusion, emissive and alpha modes map directly.
- Godot imports 3D textures as **VRAM Compressed** by default (lossy). For pixel-exact palettes set the texture import mode to Lossless; the default is fine for most assets.
- **Verified (2026-10-01):** `node studio engine-verify godot` on the official Godot 4.7.2 Linux build: **52/52** golden items (re-verified 2026-10-02 with the AK skins, the energy rifle and the buildings) load through `GLTFDocument` with the expected size and bounds, triangles, mesh/surface counts, node pivots, albedo, alpha, metallic/roughness, texture slots, emission, transparency and culling. Deliberately corrupted expectations fail as they should. `--capture` renders every item in Godot next to the studio view (`docs/demos/phase5.md`). CI repeats the check on every push.

### Buildings (`k.arch.building`)

- **Plan → modules → zones, not a node-graph port.** ProceduralBuildingsThreeJS (MIT) gets its
  detail from Blender-modeled modules and a geometry-nodes evaluator; neither fits agents that
  write code. We kept its idea (facade grammar: bays × floors → module per slot, pattern rules
  per floor) and wrote modules procedurally with the kit, so styles are data and agents can add
  them.
- **Masses** (boxes) instead of facades: wings, pavilions and porches hide each other's walls,
  which is what manor-scale plans need.
- **Tiling materials per zone**, never one unique atlas: a 40 m building at 1024 px cannot reach
  90 px/m. For Roblox, the tile-bake transform **wraps** large surfaces (cuts them on the tile grid
  and shifts each piece by whole repeats) when the plain bake would exceed 64 repeats or drop
  below the minimum texel density; assets that passed before export byte-identical.
- **Budget by detail level** (2 → 1 → 0), deterministic: the same plan always gives the same mesh.

## Quality gates the user asked for

The validator checks, before any export:

- **UV island padding** on atlas textures, measured in texels at the final export resolution (after any engine downscale), plus gutter dilation so mipmaps never bleed background colors.
- **Texture size** against the engine limit and **texel density** (texels per meter on the model), including the density that results after an engine downscale or a baked repeat. On Roblox, density below the minimum is an error ("it will look blurry").
- **Triangle counts** per mesh against the engine limit (Roblox 20k) and per asset against the budget in `meta.budget`.

Plus geometry (inverted faces, inside-out shells, degenerate/duplicate triangles), materials, scene (origin, dimensions, mesh count) and source lint.

## Agents other than Claude Code

- The workflow is tool-neutral: `AGENTS.md` is the entry point (Codex reads it natively; Gemini CLI loads it through `.gemini/settings.json` → `context.fileName`).
- The nine shortcuts are **Agent Skills** in `.agents/skills/<name>/SKILL.md`, the open format that both **Codex** (repo skills; `$asset`, `/skills`, or automatic) and **Gemini CLI** (`.agents/skills` is an alias of `.gemini/skills`) read directly.
- Codex custom prompts (`~/.codex/prompts`, `/prompts:name`) are deprecated and live in the user's home folder, so they are not used. Codex can't run skills as `/asset` yet (openai/codex#50068); `$asset` is the Codex form.
- Real slash commands are generated from the skills by `node studio agents`: `.claude/commands/<name>.md` (`$ARGUMENTS`) and `.gemini/commands/<name>.toml` (`{{args}}`). A test fails when they drift.
- All names start with `asset` because Claude Code's built-in `/review` and `/export` win name collisions with project commands.

## Skins (one model, many looks)

- A skin is a set of surface param overrides (`skins`). Every skin build is compared with the default look in the same profile: per-mesh hashes of positions/indices, normals and UVs plus the material slots (`skin.geometry-changed`, `skin.materials-changed`). This is what lets engines swap skins on one model.
- Assets with skins keep identically looking materials apart and get one Roblox palette swatch per flat material in declaration order, so UVs never depend on colors. Assets without skins are byte-identical to before (golden unchanged).
- Textures for skins are painted in 3D (`k.bake.surface` + `paint3d`): patterns are functions of the surface position, so they continue across UV seams; edge/cavity masks come from the real mesh, AO from three-mesh-bvh ray casts. Bakes are cached by content.
- Roblox SurfaceAppearance textures are not scriptable at runtime, so each skin is a premade SurfaceAppearance per MeshPart, swapped by `SkinSwitcher` (plain Lua 5.1 syntax, so it parses everywhere). Metalness and roughness are separate maps there, split from the glTF metallicRoughness texture.
- Generic exports get one extra GLB with every look as `KHR_materials_variants` (passes the Khronos validator); Godot uses per-look GLBs.

## Roblox Open Cloud publishing

- Research (2026-10): the Assets API creates Models from `.glb` (`model/gltf-binary`, ≤ 20 MB per call) and Images/Decals from `.png`; `PATCH /assets/v1/assets/{id}` uploads new versions of Models only; results are operations polled at `/assets/v1/operations/{id}`; auth is the `x-api-key` header; 60 requests per minute per key. `.rbxm/.rbxmx` uploads exist but files written outside Studio "might not upload or function", so the skins `.rbxmx` is written locally for Insert from File.
- Credentials only from `ROBLOX_API_KEY` / `ROBLOX_CREATOR` (environment or gitignored `.env`); never logged, stored in reports, or put in error messages (tested).
- `.studio/roblox/published.json` keeps asset ids per item and per image hash per creator: unchanged models are skipped, changed ones become versions, identical maps upload once.
- Verified against a local fake Open Cloud server in the tests. A real upload needs the user's key.

## Tooling choices

- Node ≥ 20, ESM, plain JavaScript with JSDoc (no build step). `node studio <command>` is the CLI.
- No Vite: a tiny `node:http` server with an import map, so the browser runs the same kit/asset modules as Node (needed for the source-vs-GLB parity render).
- Headless renders use Playwright Chromium with **SwiftShader forced**, so screenshots are deterministic across machines (baselines and parity stay comparable).
- `three-bvh-csg` is imported from its ESM source (`three-bvh-csg/src/index.js`) to avoid loading a second (CommonJS) copy of three.js in Node.
- three.js `toCreasedNormals` welds positions on a 1 cm grid; the kit scales small geometry up before computing normals so rivets and bolts keep correct shading.

## Reliability

- **Preview = Export** is enforced, not assumed: `export` rebuilds from scratch and refuses to write a file whose bytes differ from the preview the user approved.
- **Golden suite** (`node studio golden`): 24 assets / 52 items × 3 profiles (skins included), checked for validation, determinism, structure (`golden/manifest.json`), visual regression against committed baselines and source-vs-GLB parity. Baselines change only through `--update-baselines`, so an unnoticed visual change cannot slip in.
- The viewport environment map (PMREM) is built once per renderer: on software WebGL each rebuild cost about 2 s, so caching it made every render command 10–20× faster without changing a pixel.
- **History** stores each version's parent, so `undo` follows the edits actually made, even after a revert; unsaved work is auto-saved before any restore.
