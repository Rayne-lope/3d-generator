# Architecture

The studio is a local Node toolchain plus a browser viewport. An AI coding agent writes asset
code. Everything after that (building, validating, rendering, exporting, versioning) is done by
`node studio <command>`, so a human and an agent get exactly the same results.

```
prompt ──► agent writes assets/<slug>/asset.js (kit code)
             │
             ▼
   node studio build / review / export / golden          (Node, deterministic)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ load asset module → runAsset (seeded rng, params+variant, origin)        │
   │   → three.js scene → IR (bake transforms, merge per material per part)   │
   │   → engine profile transforms (units, palette atlas, factor bake,        │
   │     split by material, tile bake, texture limits, triangle split,        │
   │     dilation, emissive clamp)                                            │
   │   → glTF-Transform → GLB (PNG textures, MikkTSpace tangents, no lossy)   │
   │   → inspect GLB → validate (Khronos + studio checks) → report            │
   └──────────────────────────────────────────────────────────────────────────┘
             │ .studio/preview/<item>/<profile>.glb (+ .report.json)
             ▼
   viewport (browser) loads that GLB with GLTFLoader ── Preview = Export
   headless capture page (Playwright + SwiftShader) renders the same GLB for
   review sheets, parity, diffs, golden baselines
             │
             ▼
   export → exports/<profile>/<item>.glb  (only if 0 errors and bytes == preview)
```

## Source layout

| Path | Role |
| --- | --- |
| `studio/index.js` | CLI entry. Dispatches `node studio <command>` to `studio/cli/<command>.js`. |
| `studio/kit/` | The asset toolkit (isomorphic: Node + browser, no Node built-ins). `k.js` is the namespace; geo, ops, uv, texture painter, 3D surface bake (`bake.js`) and patterns (`patterns.js`), materials, terrain, arch, csg, rng, noise, units. `runtime.js` runs an asset definition (params: defaults ← variant ← skin). |
| `studio/core/ir/` | `from-three.js`: three.js scene → IR (rejects anything non-portable with a fix hint). `to-gltf.js`: IR → glTF-Transform document → GLB. |
| `studio/core/transforms/` | Engine profile transforms on the IR (`index.js`) and pixel helpers (`pixels.js`). |
| `studio/core/validate/` | Khronos glTF validator + studio checks (`checks/geometry, texture-uv, material, scene, source`). Issues are `{ id, severity, message, hint, where }`. |
| `studio/core/build.js` | One item × one profile: build → GLB → inspect → validate → report. Results are cached by a hash of the asset folder, the set folder, the kit, the core and the profiles. |
| `studio/core/render/` | `capture.js` drives the headless capture page. `image.js` handles PNGs, pixel diffs and grids. |
| `studio/core/review.js` | Contact sheets, lineups, the parity check (source scene vs GLB), and the debug images: parts view (source scene colored per `k.part`), blueprint (orthographic views with grid and rulers) and the reference overlay (silhouette IoU against `meta.reference`). |
| `studio/core/history.js` | Versions (save/revert/undo/pin/prune, parent links) and the unified source diff. |
| `studio/core/diff.js` | Version diffs: shared-camera renders, two-level change map, stats delta, source diff. |
| `studio/core/export.js` | Strict export (error gate, fresh-rebuild byte check, parity, reports). |
| `studio/core/golden.js` | Golden suite (validate, determinism, structure, regression, parity) + HTML report. |
| `studio/core/skins.js` | Skin packs (maps per look, `skins.json`, Roblox SurfaceAppearance maps + SkinSwitcher, `KHR_materials_variants` GLB). |
| `studio/core/roblox-cloud.js`, `studio/core/publish.js` | Open Cloud client (create/update/poll, retries, credentials) and `publish --roblox` (registry, image reuse, `.skins.rbxmx`). |
| `studio/core/validate/checks/skin.js` | Skin lock: a skin must keep the default look's mesh and material slots. |
| `studio/core/engines.js` | Godot/Roblox packs, Godot discovery, headless verification and capture. |
| `studio/profiles/*.json` | Engine profiles: units, limits, material/texture/UV policy, import hints, verification notes. |
| `studio/server/server.js` | Dev server: static mounts, import map, `/api/*`, SSE events, recursive file watching, rebuilds in child processes. |
| `studio/viewport/` | Browser viewport (`index.html`, `app.js`), the capture page (`capture.html/js`) and the rendering setup they share (`scene-setup.js`). |
| `studio/templates/` | Scaffolds for `new` and `new-set`. |
| `assets/`, `sets/` | Asset code (the only place the agent writes code) and shared set styles. |
| `rules/`, `AGENTS.md`, `CLAUDE.md` | What the agent reads. |
| `.agents/skills/` | The workflow shortcuts as Agent Skills (read directly by Codex and Gemini CLI). `node studio agents` (`studio/core/agents.js`) generates `.claude/commands/` and `.gemini/commands/` from them; `.gemini/settings.json` makes Gemini CLI load `AGENTS.md`. |
| `golden/` | `golden.json` (the set), `manifest.json` (expected structure), `baselines/` (expected renders), `report/` (generated). |
| `engines/` | Godot reference project (verify script + gallery) and the Roblox verify script + checklist. |
| `.studio/` | Local state (gitignored): previews, history, shots, metrics, server info. |
| `exports/` | Engine files written by `export` (gitignored). |

## Key design decisions

**Preview = Export.** The viewport never builds geometry. It loads the GLB that the exporter
wrote, so what the user approves is the file the engine gets. `export` verifies this: it rebuilds
from scratch and compares bytes with the preview before writing.

**Determinism.** Asset code gets a seeded `rng` with named streams and seeded noise. Clocks,
`Math.random` and Node APIs are linted out. The GLB writer emits no timestamps. Identical source
always gives identical bytes, which is what makes caching, golden tests, version diffs and the
Preview = Export check possible.

**IR between three.js and glTF.** The IR flattens the scene: transforms are baked, mirrored
transforms are fixed, instancing is expanded, non-separate parts are merged per material, and
separate parts keep their pivot as a node. Profile transforms then work on plain arrays (UVs,
pixels, triangles) instead of three.js objects, and the IR is the single place where portability
rules are enforced.

**Engine profiles are data plus transforms.** The JSON holds limits and policies. The transforms
make an asset fit an engine without touching the asset code. For Roblox: studs, colors baked
into textures because the importer drops color factors, a palette atlas so flat colors stay one
MeshPart, one material per mesh, repeats baked into 0..1 UVs, ≤ 1024 px textures, a 20k-triangle
split, and gutter dilation. The preview of a profile shows the transformed result.

**Validation measures the final file.** Checks run on the profile's GLB as written. UV padding
is measured in texels at the final texture size (after any engine downscale). Texel density is
area-weighted per material. Triangles are counted per mesh against the engine limit. Errors
block export; nothing in the asset can switch a check off.

**Same renderer everywhere.** The viewport and the headless capture page share
`scene-setup.js` (neutral lighting, framing, single-sided rendering). Headless Chromium is forced
onto SwiftShader, so renders are reproducible across machines. That makes parity checks, version
diffs and golden baselines meaningful. The environment map is built once per renderer, because
PMREM on software WebGL costs about 2 s.

**Child-process builds.** The dev server rebuilds in child processes (`node studio build --json`),
so an asset with an infinite loop or a crash cannot take the viewport down, and module caching
never serves stale code. CLI builds notify a running server so the viewport refreshes whoever
started the build.

**History is content-addressed.** A version stores the source snapshot, the generic GLB and
stats; skipping and "dirty" detection use a hash of the source folder. Each version records its
parent, so undo follows the real edit chain. Restores always auto-save unsaved work first.

## Data formats

- `.studio/preview/<item>/<profile>.report.json`: the build report (dimensions, triangles per
  mesh and part, materials, textures with density and padding, issues, notes, parity, hashes,
  import hints). `export` writes the same report next to the exported GLB, plus a Markdown
  version.
- Item ids: `<slug>`, `<slug>--<variant>`, `<slug>@<skin>` (and `<slug>--<variant>@<skin>`); preview, shots and export paths all use the item id. Reports carry `skin`, `skins` and a `geometry` fingerprint (per-mesh hashes) used by the skin lock.
- `golden/manifest.json`: the structural fingerprint per profile/item (triangles, meshes, node
  pivots, materials with colors and factors, textures, size, bounds). The golden suite and both
  engine checks compare against it.
- `.studio/history/<target>/index.json`: the version list plus `head`. Each `vNNN/meta.json`
  holds the message, parent, source hash and stats.
- `.studio/metrics.json`: per-asset timestamps (created, first GLB, first save, exports) for
  `stats`.

## Testing

- `npm test`: unit and integration tests (kit determinism, painters, normals, atlas padding,
  exporter and profile transforms, every validator gate, history, strict export, and a CLI smoke
  run). No browser needed.
- `node studio golden`: the end-to-end suite with renders (needs Chromium).
- `node studio engine-verify godot`: the real-engine check (needs Godot 4.3+).
- CI (`.github/workflows/ci.yml`) runs all three.
