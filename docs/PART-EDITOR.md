# Part selection and gizmos

Run `node studio dev` and open http://127.0.0.1:5178. The part editor starts with
the treasure chest's lid, the mailbox's flag and the pressure valve's handwheel.
Their variants use the same stable part IDs.

## Select and transform a part

1. Select an asset from **Assets**, then open **Parts** in the left sidebar.
2. Select a part in the hierarchy or click its mesh in the canvas. Meshes split
   into several pieces by the Roblox profile still select their authored parent.
3. Use **Move**, **Rotate**, or **Scale**, or enter values in the inspector.
4. Release the gizmo to commit one change. Wait for autosave and the new GLB to
   finish before exporting or saving a version.

The root and `Body (merged)` are read-only. Parts without editor metadata remain
available for inspection. A part needs a stable ID, its own exported node and a
meaningful pivot to offer a gizmo. Selecting a part does not change the scope of
Export: it exports the whole asset.

Move uses world axes in the canvas and parent-local offsets in the numeric
inspector. Offsets are stored in meters and displayed in centimeters. Rotate uses
local axes, with inspector offsets in Euler XYZ degrees and a quaternion on disk.
Scale is uniform, displayed as a percentage of the authored size. The exporter
bakes scale into geometry, so the inspector reads source overrides rather than
the loaded node's scale property.

Pilot offset limits are −2 to +2 meters on each axis; scale ranges from 25% to
400%. Negative scale is unavailable. Parts below a nonuniform or sheared parent
transform show a reason instead of offering an unsafe gizmo.

| Shortcut | Action |
| --- | --- |
| Q | Select |
| T | Move |
| R | Rotate |
| S | Uniform scale |
| Escape | Cancel the active gesture |
| Cmd/Ctrl+Z | Undo a committed parameter or part edit |
| Cmd/Ctrl+Shift+Z / Ctrl+Y | Redo |
| Cmd/Ctrl+S | Open Save Version |

Shortcuts do not take over native text editing. **Focus** frames the selected part.
**Snap** starts off; when enabled, it uses 1 cm for Move, 15° for Rotate and 5%
for Scale. Camera orbit is temporarily disabled while dragging.

## Drafts, autosave and recovery

During a drag, a temporary copy of the GLB part moves immediately and is marked
as a draft. The last validated GLB is retained for rollback. A draft is not an
exported file, and Export and Save Version wait for a current rebuilt preview.

Pointer-up autosaves one transform and triggers a rebuild. Escape cancels without
writing source. Switching asset or profile cancels an unfinished gesture. The
selected part is retained after rebuild when its ID still exists.

An autosave failure offers Retry or Discard. A source conflict offers Reload
source or Reapply draft. If a build fails, the working copy remains saved and the
last successful GLB is shown as old; Retry build or Undo can recover. Skins and
historical previews are read-only.

Parameter and part edits share the same 50-step Undo/Redo stack for each asset
and Base/variant scope. Save Version checkpoints the full asset, including both
domains. Restore returns all source files and overrides together. See the
[working-copy and version guide](EDITOR.md) for checkpoint behavior.

## Base, variants and authored pose

Transform offsets apply after procedural generation and origin placement,
relative to the part's authored pose. Opening angle and other source parameters
continue to work: an `open` chest first takes its open pose, then receives the
stored transform adjustment. The asset origin is not recalculated after moving
a part.

A Base transform is inherited by variants. Once a variant has its own record for
a part, that whole record replaces the inherited transform. Editing a variant
starts from its effective transform, including any Base adjustment.

**Reset transform override** removes that scope's record. Resetting a variant
returns to the Base adjustment on the authored variant pose. It does not force
an open lid closed. Skins inherit the same geometry transforms.

Transforms live in the optional `partTransforms` field of
`assets/<slug>/editor.json`. Older sidecars without that field still work. Parameter
edits preserve part transforms, and part edits preserve parameters. Build,
validation, review, parity, history and strict export all use the same resolver.

## New assets

Editor support is standard in the asset templates and modeling workflow. You can
ask for an asset normally; the modeling agent supplies curated controls, stable
part IDs and pivots for meaningful moving or detachable pieces.

A monolithic asset gets useful parameter controls. A gizmo is available when a
part is deliberately authored as separate and registered as editable. Decorative
detail stays merged unless it has a reason to be separate. Seed, texture size
and implementation settings are not automatically exposed.

Existing assets are not migrated automatically. They can be opted in with the
contract in [KIT.md](KIT.md), preserving their shape and export structure.
