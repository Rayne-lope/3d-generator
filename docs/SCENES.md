# Scenes: rooms assembled from the library

A scene places assets you already have into a room and exports the result as **one GLB in
which every placed asset is still its own node**, so the engine can move, script or replace
them one by one. Assets are placed at their real size (meters); a scene never scales them.

Run `node studio dev`, open http://127.0.0.1:5178 and choose the **Scenes** tab in the sidebar.

## The scene file

`scenes/<name>/scene.json` is the whole scene. The browser, the CLI and a coding agent all
edit this one file.

```json
{
  "version": 1,
  "title": "Tavern corner",
  "prompt": "a cozy tavern corner with one table and three stools",
  "interpretation": "6 × 4 m room, door on the front wall, the table in the middle.",
  "room": {
    "width": 6, "depth": 4, "height": 3, "wallThickness": 0.2, "ceiling": true,
    "openings": [
      { "wall": "front", "offset": -1.5, "y": 0, "w": 0.9, "h": 2.1, "shape": "rect" },
      { "wall": "left", "offset": 0.5, "y": 0.9, "w": 1.2, "h": 1.2, "shape": "rect" }
    ],
    "finishes": {
      "wall": { "kind": "plaster", "color": "#e6e2d8" },
      "floor": { "kind": "wood", "color": "#9a6a40" },
      "ceiling": { "kind": "plaster", "color": "#f2f0ea" }
    }
  },
  "instances": [
    { "id": "table-1", "asset": "tavern-table", "variant": null, "skin": null, "position": [0, 0, 0], "yaw": 0 },
    { "id": "mug-1", "asset": "tavern-mug", "variant": "empty", "skin": null, "position": [0.3, 0.76, 0.1], "yaw": 30 }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `room` | Inside size in meters, or `null` for a layout without a shell. The room is centered on the origin and the floor is y = 0. |
| `room.openings` | Cut into a wall. `wall` is `front` (+Z), `back` (−Z), `left` (−X) or `right` (+X); `offset` runs along the wall from its middle; `y` is the sill height (0 = a door). Shapes: `rect`, `arch`. Keep 5 cm from corners, the ceiling and other openings. |
| `room.finishes` | A flat finish per surface: `kind` (plaster, concrete, brick, stone, wood, painted-wood, varnished-wood, ceramic, plastic, fabric, rubber) and a hex `color`. |
| `instances[].id` | A unique name; it becomes the node name in the engine. |
| `instances[].asset` / `variant` / `skin` | What is placed. |
| `instances[].position` | `[x, y, z]` of the asset's origin (its base center) in meters. |
| `instances[].yaw` | Degrees around the vertical axis. 0 = the asset's front faces +Z. |
| `instances[].locked`, `name` | Optional: protect from the gizmo; a label for the outliner. |
| `instances[].group` | Optional: instances with the same group name are one unit (a table with its chairs). They are picked and moved together and export under one node named after the group. |

Doors and windows are openings only. Place a door or window asset in the opening if you have one.

## Composing in the browser

1. **Scenes → New**: name the scene and set the room size. Or pick an existing scene.
2. **Library**: every asset as a card with its thumbnail and real size. Click a card, move the
   pointer into the room, click to drop. Shift+click keeps placing the same asset, **R** turns
   it 90°, **Esc** cancels. An asset without a preview is built first (the hint says
   *Loading…*).
3. **Select** a placed asset in the room or in the *Placed* list. **Move** (T) and **Turn**
   show a gizmo; the inspector on the right has exact position and yaw fields, variant and
   skin, Duplicate, Delete, Lock, Focus and **Drop** (rest on whatever is below: another asset,
   or the floor).
4. **Room** in the inspector: size, wall thickness, ceiling, finishes, and the list of
   openings (Add door / Add window). An opening that cannot fit is rejected and rolled back.

### Blocks: several at once

- **Select several:** Shift- or Cmd/Ctrl-click in the room or in the *Placed* list; Cmd/Ctrl+A
  selects everything. In **Plan view**, drag a rectangle on the floor to select what it touches.
- **Move and Turn** then act on the whole block: it shifts in grid steps (the spacing inside it
  stays), sticks to walls as one box, and turns around its middle. Arrow keys nudge it one grid
  step. Duplicate, Delete, Drop and Lock work on all of it; locked instances stay put.
- **Array** repeats the selection on a grid: *Columns* along X, *Rows* along Z, each with a
  spacing in meters. The spacing starts at the selection's own size, so copies touch: add your
  aisle width. Two shelf racks back to back, 3 columns 2.6 m apart and 4 rows, give three
  aisles of eight racks. The whole array is one undo step.
- **Group** (Cmd/Ctrl+G) makes the selection one unit; **Ungroup** is Cmd/Ctrl+Shift+G. A click
  on a member selects the group, a double-click (or its row in the list) only that member.
  Copies and array cells of a group become groups of their own.

Snapping (hold **Alt** to move freely):

| Control | What it does |
| --- | --- |
| Grid | Positions snap to 10 cm, 25 cm, 50 cm or **1 stud** (0.28 m). The floor shows the grid. |
| Wall snap | Near a wall an asset moves flush against it. While placing it also turns its back to the wall, front toward the room. |
| Stack | While placing, the asset rests on the surface under the pointer (a mug on a table) instead of the floor. |
| Turn | The turn gizmo snaps to 15° when the grid is on. |

Views: **Plan view** (P) looks straight down with the ceiling hidden; openings show as amber
(door) and blue (window) marks on the floor. In the normal view the walls between the camera
and the room hide themselves. **Ceiling** shows the ceiling once the camera is inside.

The figure select in the top bar (H cycles) adds a scale reference: a 1.75 m human, or a
Roblox **R6** or **R15** avatar (5.1 studs tall, 4 studs wide with its arms out). In a scene it
stands next to the selected asset.

| Shortcut | Action |
| --- | --- |
| Q / T | Select / Move |
| R, Shift+R | Turn the selection (or the asset being placed) 90° |
| Delete | Delete the selection |
| Cmd/Ctrl+D | Duplicate |
| Shift/Cmd/Ctrl+click | Add to or take out of the selection |
| Cmd/Ctrl+A | Select everything |
| Cmd/Ctrl+G, Cmd/Ctrl+Shift+G | Group, ungroup |
| Arrow keys | Nudge the selection one grid step |
| F | Focus the selection (or frame the room) |
| P | Plan view |
| Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z | Undo, redo (50 steps) |
| Cmd/Ctrl+S | Save Version |
| Esc | Cancel placing, then leave the tool, then clear the selection |

## Saving

Every committed edit **autosaves** `scene.json`. **Save Version** keeps a checkpoint with a
note (the last 20 are kept); **Restore** brings one back and auto-saves unsaved work first.
Commit `scenes/` to git for the long term: checkpoints live in the gitignored `.studio/`.

If a coding agent or another window changes the scene, it reloads by itself. When you have
unsaved edits at that moment, you choose between *Reload from disk* and *Keep mine*.

## The scene report and export

The **Scene report** follows your edits: total size, triangles, meshes, the count per asset,
and the issues.

| Issue | Meaning |
| --- | --- |
| `scene.unknown-asset`, `scene.unknown-variant`, `scene.unknown-skin` (error) | An instance points at something that does not exist. |
| `scene.member-errors`, `scene.member-build-failed` (error) | A placed asset fails its own validation for this engine. Fix the asset first. |
| `scene.outside-room` (warning) | An instance sticks out through a wall, the floor or the ceiling. |
| `scene.triangles-total`, `scene.mesh-count` (warning) | Above the engine's recommended totals (Roblox: 60,000 triangles, 40 meshes). |
| `scene.overlap` (info) | Two bounding boxes intersect. Often intended (a stool under a table). |

**Export** runs the strict scene export for the selected profile: errors block it, and the
scene is composed a second time from scratch and compared byte for byte. It writes to
`exports/<profile>/scenes/`:

| File | What it is |
| --- | --- |
| `<name>.glb` | The room (`room` → `floor`, `wall-front`, …) and one node per instance, named by its id; grouped instances sit under a node named after their group. Instances of the same asset share its meshes and textures. The Roblox file is in studs. |
| `<name>.report.md` / `.report.json` | Totals, the placed assets, issues and the import steps. |
| `<name>.layout.json` | Every instance with its position in meters and in studs, for engine-side scripts. `items` holds the attachments and collision shapes of each placed asset that declares them. |

**Roblox Studio**: File → Import 3D → pick the `.glb`, keep *Scale Unit: Stud*. Each placed
asset arrives as its own group of MeshParts. Whether the importer keeps the groups nested
exactly like the file, and whether it uploads repeated meshes once, has not been checked in
Roblox Studio yet (`engines/roblox/CHECKLIST.md`, section 7).

**Godot**: drop the `.glb` into the project; every instance is a child node of the scene.

## With a coding agent

Ask in plain words, or use the shortcut:

```
/scene a small hospital ward: two beds against the back wall, a nightstand and an IV stand next to each, door on the front wall
```

The agent reads the library (`node studio scene library --json`), writes `scene.json`, renders
`node studio scene review <name>` and looks at the sheet (labeled plan, two dollhouse views,
two eye-level views) before saving. You then adjust the layout in the Scenes tab. If the scene
needs an asset that does not exist, the agent says so instead of substituting one.

## CLI

```bash
node studio scene new <name> [--room 6x4x3|none] [--title t] [--prompt p]
node studio scene list
node studio scene library [--set s] [--category c] [--looks] [--json]   # assets with real sizes
node studio scene validate <name> [--profile p]
node studio scene build <name> [--profile p|all]        # composed preview GLB + report
node studio scene review <name> [--profile p]           # contact sheet; open the PNG it prints
node studio scene export <name> --profile <p|all>       # strict export
node studio scene save <name> -m "<what changed>"  |  node studio scene history <name>  |  node studio scene restore <name> <vNNN>
```

## Limits in this version

- Instances turn around the vertical axis only, and are never scaled.
- Groups are flat (no groups inside groups) and are not reusable across scenes yet.
- Room finishes are flat colors; walls have no tiling textures, door leaves or window frames.
- No walkthrough (first-person) camera yet.
- The Roblox export is one GLB. A layout that reuses already published assets by id is not
  written yet; `<name>.layout.json` has the data for it.
