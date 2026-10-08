# Stage 2 verification — 2026-10-09

Part selection and persisted Move, Rotate and uniform Scale are enabled for the
treasure chest's `lid`, mailbox's `flag` and pressure valve's `handwheel`. Existing
parameter editors remain available. See [the part editor guide](PART-EDITOR.md).

## Source and export checks

- Independent pilot tests cover seven Base/variant looks in Generic, Godot and
  Roblox: **21 default builds and 21 transformed export scenarios**. Every
  scenario has zero validator errors. Default fingerprints preserve triangle,
  mesh, material and texture counts.
- Transformed strict exports are deterministic, byte-identical to their preview
  GLBs and pass source–GLB parity. Reset, Base inheritance and whole-record
  variant replacement are checked separately.
- Tests cover optional metadata, unique stable part IDs, Roblox material/chunk
  splitting, authored pivot composition, nested parents, old sidecars, mixed
  parameter/transform writes, invalid and unavailable transforms, revision
  conflicts, snapshots and source restore.
- API checks reject malformed requests before writing source, including an
  otherwise valid transform combined with an invalid profile. Save Version
  includes variant artifacts for editors that expose only parts.
- Template tests create standalone and set-member assets with useful parameter
  inspectors without an extra prompt instruction. A separate-part fixture also
  receives transform metadata and exports in all profiles; its skins retain the
  same transformed geometry.

## Browser and visual checks

Browser tests use isolated source and state directories. They exercise real
pointer gestures for Move, Rotate and Scale, numeric transforms, variant
inheritance, reload, Undo/Redo, Save Version, historical transform values,
restore and strict export. Recovery checks cover Escape, failed autosave with
Retry/Discard, external-write conflicts, failed builds, and stale events. The
existing parameter editor browser regression suite remains part of the gate.

An additional regression keeps Move active while toggling dimensions, normals,
UV, texel density, wireframe and backfaces. The selected subtree remains
visible, no render error occurs and source revision stays unchanged. Draft
cloning preserves real Material references and excludes viewport helpers;
raycasting also excludes helper descendants.

All **21 default GLB review sheets** were opened and inspected, including the
open lid, lowered flag, pink mailbox and red-zone valve. Each source–GLB parity
check passed. The three parts sheets and Roblox lineup were also inspected.
Default geometry and appearance were retained.

The final local UI was checked on the running studio with the lid selected and
Move active. Its inspector reads 924 triangles and one baked Roblox material.
The [captured editor view](demos/img/part-editor.png) shows the GLB, hierarchy,
transform inspector and active gizmo together.

Final `npm test`: **102/102 passed**, zero failed or skipped. The test command
limits file-level concurrency to two, because the suite now combines several
software-rendered browsers and capture pipelines. This avoids the input timeout
observed under unrestricted parallelism without relaxing assertions or operation
timeouts. Generated agent shortcuts are current (`node studio agents --check`),
and `git diff --check` is clean. Existing user source edits and working-copy
overrides were preserved.

The all-profile golden suite passed **156/156** (52 per profile), without
updating any baseline. Golden checks used isolated copies of the authored
sources with `editor.json` omitted, because a user's intentional working-copy
override is not a default-render regression. The original working copies were
left intact.

## Engine checks remaining

Godot import cannot be verified on this machine because a Godot runtime is not
installed. The Roblox check pack was regenerated with
`node studio engine-pack roblox --variants --json`: **52 GLBs, zero skipped**,
plus the manifest and `GoldenVerify.rbxlx`. Roblox actual Import 3D and in-engine
appearance checks also remain
unverified: native UI control could not reliably select an isolated test window
while existing games were open. Existing games were not changed and no assets
were published. Follow [the Roblox checklist](../engines/roblox/CHECKLIST.md) for
the remaining import, scale, texture, face and pivot checks.

The acceptance evidence above covers the local studio pipeline. These real
engine checks remain explicit acceptance limitations.
