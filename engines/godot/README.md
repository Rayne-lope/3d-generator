# Godot reference project

A minimal Godot 4 project that loads the golden GLBs exported by the studio, checks them and
shows them in a gallery. It proves that studio exports work in Godot **without manual fixes**.

## Automatic check

```bash
node studio engine-verify godot             # pack + headless check (about 10 s)
node studio engine-verify godot --capture   # also renders every item in Godot, saved next to the
                                            # studio render: engines/godot/verify/compare.png
```

Godot is found through `$GODOT_BIN`, then `godot` or `godot4` on PATH, then
`/Applications/Godot.app` on macOS. Godot 4.3 or newer is needed; the standard build (not .NET)
is enough. `--capture` needs a display (on a headless Linux machine it uses `xvfb-run`
automatically).

The command does the following:

1. `node studio engine-pack godot` exports the golden set (all items and variants) with the
   **Godot profile** to `engines/godot/golden/`, plus `manifest.json` with the expected values.
2. `godot --headless --path engines/godot --script res://verify/verify_golden.gd` loads each GLB
   with `GLTFDocument` (the same loader the editor import uses) and checks:
   - size and bounds in meters (catches a moved origin or pivot), within 2 mm / 0.5 %
   - triangle, mesh-node and surface counts (exact)
   - the local position of each mesh node (separate parts keep their hinge/axle pivot)
   - per material: albedo color (sRGB), alpha, metallic, roughness, the texture slots present
     (color, normal, metallic/roughness, occlusion, emissive), emission, transparency mode and
     back-face culling
3. The report is written to `engines/godot/verify/report.json`. `node studio stats` shows the
   pass rate.

**Result in development:** Godot 4.7.2 (official Linux build), 38/38 golden items passed
(100 %). Introducing deliberate errors into the manifest (one triangle, a color, a pivot, a
size) made the check fail as expected.

## Gallery

Open `engines/godot` in the Godot editor and press **F5**. Every golden item is loaded at
runtime and placed in a grid, scaled to fit its cell. The label shows its true size. Drag to
orbit and use the wheel to zoom. The lighting copies the studio viewport's *Neutral* rig.

## Using exports in your own Godot project

Copy `exports/godot/<asset>.glb` into your project. The default import settings are fine:

- 1 unit = 1 m, +Y up, the asset faces +Z, and the origin is at the base center (as exported).
- Materials become StandardMaterial3D (base color, metallic/roughness, normal, occlusion,
  emission). Faces are back-face culled, which matches the studio viewport.
- Separate parts (lids, doors, wheels) are their own nodes with the pivot on the hinge.
  Animate their rotation directly.
- Variants are separate files (`<asset>--<variant>.glb`).

For runtime loading (mods, user content), use the same code as `verify/verify_golden.gd`:
`GLTFDocument.append_from_file()` + `generate_scene()`.

## Known differences

Godot's renderer is not the viewport's renderer, so lighting is close but not identical. In the
software-rendered `--capture` images (Compatibility renderer under Xvfb), pure metals such as the
crate's corner brackets look darker: metals get their color from reflections, and that capture
setup has no sky reflections. Shape, proportions, pivots, UVs, textures and non-metal colors
match.
