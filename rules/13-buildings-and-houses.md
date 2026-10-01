# 13 — Buildings and houses (core essentials)

Houses are read against the player: doors, windows and stairs must fit a 1.75 m human, walls
must have real thickness, and roofs must make the silhouette.

## 1. Plan before modeling

Write down in `meta.interpretation`: footprint (W × D), floors, wall height, roof type, and the
openings. A small cottage: 5 × 4 m, 1 floor, walls 2.6 m, gable roof 45°, door 0.95 × 2.0,
two windows 0.8 × 0.9 at sill 0.95.

| Element | Size |
| --- | --- |
| Wall height per floor | 2.6–3.0 (stylized 2.4–3.2) |
| Exterior wall | 0.25–0.4 (stone/timber look thicker: 0.35–0.6) |
| Door | 0.9–1.0 × 2.0–2.1 (cartoon: wider, rounder) |
| Window | 0.6–1.2 wide, 0.8–1.4 tall, sill 0.8–1.0 |
| Roof pitch | 30–45° (thatch 45–55°, flat ≤ 5°) |
| Roof overhang | 0.3–0.6 |
| Plinth / foundation | 0.2–0.5 high, 5–10 cm wider than the wall |
| Stairs | riser 0.18, tread 0.28 |

## 2. Walls with openings

```js
const front = k.arch.wall({ width: 5, height: 2.6, thickness: 0.35, openings: [
  { x: 0, y: 0, w: 0.95, h: 2.0 },                  // door (y = 0 → cut from the bottom)
  { x: -1.5, y: 0.95, w: 0.8, h: 0.9 },             // window
  { x: 1.5, y: 0.95, w: 0.8, h: 0.9, shape: 'arch' },
] });
```

- `k.arch.wall` makes a closed solid with clean reveals (no boolean slivers). Use CSG only for
  odd openings.
- Gable walls: `gableHeight` adds the triangle under the roof.
- Keep ≥ 0.3 m of wall between openings and corners; align window tops with the door top.
- Place walls so corners overlap cleanly: front/back walls full width, side walls between them.

## 3. Openings need depth

- **Frames/trims** stick out 3–8 cm: `k.arch.frame({ w, h, border, depth, bottom: false })` for
  doors, with a sill under windows.
- **Glass and door leaves are set back** in the reveal (5–15 cm behind the wall face): the
  shadow line is what makes a window read.
- Mullions/muntins (thin bars) add scale instantly.
- Make the frame opening a few cm smaller than the wall opening so no faces coincide.

## 4. Roofs make the silhouette

```js
const roof = k.arch.roof({ type: 'gable', width: 5, depth: 4, pitch: 45, overhang: 0.45, thickness: 0.3 });
// place at the top of the walls: the outer surface meets the wall line at y = wallHeight
```

- Types: `gable` (default house), `hip` (all sides slope), `shed` (single slope), `flat`.
- Always give roofs **thickness** and **overhang**; add a ridge cap (`lieAlong` cylinder) or
  ridge tiles.
- Thatch: thick (0.3–0.4 m), rounded ridge, streaky straw texture running down the slope.
  Tiles/shingles: thinner roof (0.1–0.15), courses as texture stripes or stepped geometry.
- Chimneys go through the roof near the ridge, 0.6–1 m above it.

## 5. Material zones (bottom to top)

Plinth (darker stone) → walls (stone/plaster/timber) → trims (wood) → roof. Each zone one
material; contrast by value. Wear and dirt concentrate at the bottom (`dirt({ from: 'bottom' })`)
and under eaves.

## 6. Modular kits

- Choose one **grid**: 2 m or 4 m modules in meters; for Roblox 8/16-stud modules
  (`k.units.studs(16)` = 4.48 m) so pieces snap on the stud grid.
- Every module's origin at a consistent corner or base center; ends cut flat; repeating details
  (crenellations, pilasters) spaced so the pattern continues across seams (half spacing at both
  ends).
- Provide the variants a builder needs: straight, corner, end, door, window (as `variants`).
- Same thickness and material on every module.

## 7. Interiors

Only when asked: interior walls 0.1–0.15, floor slab thickness 0.2–0.3, ceiling 2.6+. Close the
building (floor and ceiling) if the camera can enter; otherwise skip interiors for budget.

## 8. Budget

A small house: 2–12k triangles. Roblox: walls with textures may need several meshes (one
material per MeshPart); keep texture density ≥ 90 px/m (1024 px per ~6–10 m of wall).
