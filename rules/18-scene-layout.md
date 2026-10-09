# 18 — Scene layout

A scene places existing assets in a room (`scenes/<name>/scene.json`). Nothing is modeled here:
if a piece is missing, make the asset first. The prompt decides what the room is and how full it
feels; these rules keep it usable at human scale.

## Coordinates

- Meters, +Y up. The room is centered on the origin, the floor is y = 0.
- Walls: `front` = +Z, `back` = −Z, `left` = −X, `right` = +X. Opening `offset` runs along the
  wall from its middle (world X for front/back, world Z for left/right).
- `yaw` is degrees around +Y; 0 = the asset's front faces +Z. Against a wall, the front should
  face the room: back wall 0, left wall 90, front wall 180, right wall 270.
- Assets are never scaled. Pick another asset or variant when the size is wrong.
- An asset's origin is its base center, so `y = 0` stands it on the floor. For something on a
  table, `y` = the table's height from `node studio scene library`.

## Room size

| Room | Typical size (m) |
| --- | --- |
| Small room, office, cell | 3 × 3 to 4 × 4, height 2.6–3 |
| Ward, classroom, shop | 6 × 4 to 8 × 6, height 3 |
| Lobby, hall, canteen | 10 × 8 to 15 × 10, height 3.5–5 |

For Roblox, think in studs too (1 stud = 0.28 m): a default avatar is 5.1 studs (1.43 m) tall and
4 studs wide with its arms out, so doors and aisles that fit a 1.75 m human feel generous there.
Doors: 0.9–1.2 m wide, 2.1 m high (double doors 1.6–1.8 m). Windows: sill 0.9 m, 1.2 m high.

## Placement

- **Walkways first.** Keep a clear path of at least 0.9 m (1.2 m for main routes) from every
  door to every area. Nothing within 0.9 m in front of a door.
- **Furniture belongs to walls.** Cabinets, shelves, lockers, beds, sofas and desks stand with
  their back flush against a wall (gap 0–2 cm). Only tables, islands and seating groups float.
- **Group by use.** A table with its chairs, a bed with its nightstand and IV stand, a desk with
  its chair and cabinet. Leave 0.6 m to pull a chair out; 0.8–0.9 m beside a bed.
- **Repeat with rhythm.** Rows (waiting chairs, beds, lockers, shop shelves) share one line and
  one spacing. Compute them: a row of `n` items of width `w` is `x0 + i * w`; aisles between
  shelf rows are 1.2–1.8 m.
- **Mark units with `group`.** Things that belong together (a table and its chairs, two racks
  back to back, a bed with its nightstand) get the same `group` name (`"group": "table-set-1"`):
  the user then moves them as one, and they arrive as one node in the engine. Group names are
  lowercase with dashes and must differ from every instance id.
- **Small props last.** Mugs, trays and lamps sit on a surface, at that surface's height.
- **Leave it breathable.** Furniture covering about a third of the floor reads as furnished;
  more than half reads as storage.

## Checking

Run `node studio scene review <name>` and look at every tile:

- Plan: doors unobstructed, backs on walls, the tick of each asset points the way it faces.
- Dollhouse views: nothing floating, sunk into the floor or passing through a wall.
- Eye level: the room reads as what the prompt asked for; nothing blocks the view at the door.

Issue ids: `scene.unknown-asset` / `scene.unknown-variant` / `scene.unknown-skin` (fix the
reference), `scene.member-errors` (fix that asset for the target engine first),
`scene.outside-room` (move it in or enlarge the room), `scene.overlap` (a note: fine when
intended), `scene.triangles-total` and `scene.mesh-count` (engine totals: use lighter assets
for repeated props or split the scene).
