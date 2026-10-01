# Roblox Studio golden check

Roblox Studio cannot be driven from the command line, so this check is done by hand. It takes
about 15 minutes. It proves that studio exports import into Roblox Studio **without manual
fixes**. The PRD target is at least 90 % of the golden set.

## 1. Prepare the files (on your computer)

```bash
node studio engine-pack roblox            # 19 base assets (add --variants for all 38)
```

This writes:

| File | What it is |
| --- | --- |
| `engines/roblox/golden/*.glb` | Golden assets exported with the **Roblox profile**. Sizes are in studs (25:7 per meter), colors are baked into textures, there is one material per MeshPart, each mesh is ≤ 20k triangles, and textures are ≤ 1024 px. |
| `engines/roblox/GoldenManifest.lua` | The expected values: size in studs, MeshPart count and triangles per item. |
| `engines/roblox/GoldenVerify.rbxlx` | A template place with a baseplate, an empty `Workspace > GoldenImports` folder, the manifest (ModuleScript) and the `VerifyGolden` script, all in ServerScriptService. |

## 2. Import

1. Open `engines/roblox/GoldenVerify.rbxlx` in Roblox Studio (File > Open from File).
2. Select `Workspace > GoldenImports` in the Explorer.
3. Open **Import 3D** (File > Import 3D, or the Home/Avatar tab) and pick a file from
   `engines/roblox/golden/`. You can select several files at once if your Studio version allows it.
4. Importer settings:
   - **File Geometry > Scale Unit: Stud**, which is the default. The files are already in studs.
     Do not pick Meter, or the asset ends up 3.57× too large.
   - Anchored: on (otherwise models fall when you press Play).
   - Leave everything else at the defaults. Note any warnings the importer shows.
5. Import. If a model lands outside `GoldenImports`, drag it into the folder. Keep the model
   names: they are the file names, which is how the script finds them.
6. Write down the triangle count the importer shows for a few items and compare it with
   `triangles` in `GoldenManifest.lua`.

## 3. Run the script check

Press **Play** (F5) or **Run** (F8), then open the **Output** window. You can also paste
`engines/roblox/VerifyGolden.lua` into the Command Bar (View > Command Bar) without playing.

For each manifest item, the script prints one of:

- `PASS` — size in studs is within 2 % (`Model:GetExtentsSize()`), the MeshPart count is as
  expected, every MeshPart has a texture (colors were baked in), and no MeshPart is DoubleSided.
- `FAIL` — the reason, e.g. `size …, expected …` or `2 MeshPart(s) without texture (colors lost)`.
- `MISSING` — the item was not imported (it is left out of the pass rate).

The summary line reports `passed/imported`. The same numbers are stored as attributes on
`GoldenImports` (`GoldenPassed`, `GoldenFailed`, `GoldenMissing`).

## 4. Look at the models (what a script cannot see)

Use the Studio camera around each model, next to the default character (about 5 studs tall;
the studio's 1.75 m reference human is 6.25 studs).

| Check | What to look for |
| --- | --- |
| Colors | They match the studio viewport (`node studio dev`, profile *Roblox Studio*). No white or gray parts. |
| Faces | No holes or see-through faces from any side. |
| Textures | Sharp, with no colored bleeding along UV seams (the exporter dilates UV island edges). |
| Size | Proportions believable next to the character. A barrel ≈ 3.6 studs tall, the cottage ≈ 20 studs tall (21 wide). |
| Pivot | Select a model: the pivot sits at the base center (the shelf at its back center). Select the chest **lid** MeshPart: its pivot is on the hinge at the back edge. |
| Emissive | Crystal, lamp glass, sci-fi light strip, candle flame. Do they glow? This mapping is not verified yet. |
| Transparency | Nothing in the golden set uses alpha blending. Nothing should look transparent. |

## 5. Record the result

Copy this table into the PR or your notes:

| Item | Imported without fixes? | Notes |
| --- | --- | --- |
| stylized-barrel | | |
| lowpoly-pine-tree | | |
| realistic-crate | | |
| scifi-supply-crate | | |
| fantasy-crystal-cluster | | |
| wasteland-oil-drum | | |
| medieval-street-lamp | | |
| cartoon-mailbox | | |
| castle-wall-modular | | |
| steampunk-pressure-valve | | |
| minimalist-chair | | |
| pirate-treasure-chest | | |
| stone-cottage | | |
| meadow-terrain-tile | | |
| tavern-table | | |
| tavern-stool | | |
| tavern-mug | | |
| tavern-candle-holder | | |
| tavern-shelf | | |

**Pass rate:** passed / imported = ____ % (target ≥ 90 %).

If something fails, open an issue with the item, the Output line and a screenshot. Most fixes go
into `studio/profiles/roblox.json` or a profile transform, and then the golden suite is re-run
(`node studio golden --profile roblox`).

## Troubleshooting

- **The model is huge or tiny:** the Scale Unit was not *Stud*. Re-import.
- **The importer rejects a mesh for its triangle count:** this cannot happen with Roblox-profile
  files (meshes over 20k are split). Check that you imported from `engines/roblox/golden/` and
  not from a generic export.
- **Parts are white:** the importer lost the textures. Check that the SurfaceAppearance or
  TextureID was created and that Studio could upload the images (you must be signed in).
- **Colors look darker than the viewport:** Roblox lighting (Future/ShadowMap, exposure) differs
  from the neutral viewport. Compare under default Studio lighting.
