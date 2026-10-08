# Stage 1 verification — 2026-10-08

The visual parameter and material editor is enabled for Minimalist Oak Chair,
Wasteland Oil Drum and Medieval Street Lamp, including walnut, fresh and unlit.
See [the editor guide](EDITOR.md) for use and scope behavior.

## Automated and visual checks

- Existing tests and the editor tests run through `npm test`: **88/88 passed**.
- Contract tests exercise optional metadata, types, step/range validation, base and
  variant inheritance, skin/runtime precedence, reset, atomic persistence and
  deletion of empty overrides.
- Service/history tests exercise revision conflicts, request limits and origin
  validation, variant snapshots, sidecar restore, build event revisions, source
  changes during build/save and a failed checkpoint before restore.
- Pilot tests build all curated control extrema in Generic, Godot and Roblox with
  zero validator errors. Edited variants export deterministically and their GLBs
  match the preview bytes. Edited base/variant source–GLB parity passes in all
  three profiles.
- Browser tests exercise edits and reloads on all pilots, variant reset, Undo/Redo,
  Save Version from a focused input, historical reports and restore, exports,
  rapid commits, autosave failure/recovery, conflict reapply, stale build events,
  a smaller viewport and preview-only assets.
- All 18 default base/variant/profile GLB review sheets were inspected visually,
  together with the three lineups and each pilot's parts and dimension sheets.
- Golden suite: **156/156 passed**, 52 in each profile. Baselines were unchanged.
  This run used isolated copies of the authored sources without `editor.json`:
  live user overrides deliberately change the model and are not default visual
  regressions. The working-copy files were preserved.

The golden gate exposed an existing large-atlas failure on Roblox buildings.
Atlas dilation now assembles UVs in a preallocated typed array instead of passing
the entire UV array as function arguments. A 180,000-scalar UV regression test
covers the failure; all existing golden renders still match their baselines.

## Engine checks remaining

Godot import was not run: a Godot runtime was not found on this machine.

The Roblox check pack was generated with
`node studio engine-pack roblox --variants --json`: **52 GLBs, zero skipped**,
plus `engines/roblox/GoldenManifest.lua` and `engines/roblox/GoldenVerify.rbxlx`.
Actual Import 3D and in-engine appearance checks remain unverified. Native UI
control could not reliably select the isolated test window while existing game
windows were open. No existing Roblox game was modified and no asset was
published. Follow [the engine checklist](../engines/roblox/CHECKLIST.md) to finish
scale, texture, face, pivot and emissive checks in Roblox Studio.
