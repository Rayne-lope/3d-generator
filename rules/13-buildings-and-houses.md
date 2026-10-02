# 13 — Buildings and houses (core essentials)

Houses are read against the player: doors, windows and stairs must fit a 1.75 m human, walls
must have real thickness, and roofs must make the silhouette.

**Anything bigger than a hut: use `k.arch.building` (section 9).** It lays out masses, bays and
floors, places every window, door, band, quoin, dormer and chimney, fits a triangle budget and
passes Roblox. Sections 1–8 are the craft behind it and the way to build small one-off pieces.

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

## 9. Procedural buildings: `k.arch.building`

```js
const house = k.arch.building({
  name: 'manor',
  style: 'georgian',                     // or 'medieval-timber', 'paris-haussmann', 'modern', or a style object
  masses: [                              // boxes of the plan (meters, front = +Z)
    { id: 'main', width: 22, depth: 13, floors: 3 },
    { id: 'east', x: 15, z: -2, width: 9, depth: 11, floors: 2, chimneys: { count: 1 } },
  ],
  entrance: { mass: 'main', side: 'front' },           // door on the center bay
  portico: { columns: 4, bays: 3, floors: 2, pediment: true },
  finishes: { wall: { kind: 'brick', color: p.brick, tile: 1.2 } },   // per material zone
  budget: 40000,                         // lowers detail (2 → 1 → 0) until it fits
});
asset.add(house.part);                   // house.stats: triangles, detail, per zone
```

How it works (so you can predict it):

1. **Masses** are boxes. Each has 4 sides; each side is split into **bays** (style `bay.width`,
   `margin` at the corners, odd count on the entrance side when `symmetric`). Every bay × floor is
   a **slot**: the door, or a window whose size depends on the floor role (`ground`, `noble` = the
   first floor in classical styles, `upper`, `top`).
2. **Masses hide each other**: a wall part inside another mass gets no windows, and no wall when
   the whole floor is covered. Overlap wings 0.3–1 m into the main block; a lower wing leaves the
   main block's upper floors exposed (windows appear there).
3. **Modules** dress the slots: frames, sills, heads (`lintel`, `keystone`, `pediment`, `cornice`),
   sash bars, shutters, balconies, door with fanlight, pilasters and steps, plinth, string courses,
   cornice, quoins, timber framing (posts, rails, chevrons, gable timbers), jetties, roofs
   (`gable`, `hip`, `mansard`, `shed`, `flat`), dormers, chimneys, portico.
4. **Materials** are tiling textures per zone: `wall`, `trim`, `roof`, `frame`, `glass`, `door`,
   `metal`, `timber`, `chimney`, `shutter`. Finish kinds: `brick`, `ashlar`, `rubble`, `plaster`,
   `concrete`, `slate`, `clay-tiles`, `thatch`, `zinc`, `timber`, `paint`, `glass`, `iron`. Big
   buildings never use one unique atlas (a 30 m manor at 1024 px would be far below 90 px/m).
5. **Roblox:** large tiling surfaces are cut on the tile grid automatically so UVs fit 0..1 at
   full sharpness; meshes split per material and at 20k triangles.

| Style | Look | Key settings |
| --- | --- | --- |
| `georgian` | symmetrical brick, stone trim, sash windows, hipped slate roof, dormers, end chimneys | ground 4.4 m with a 0.75 m plinth, bays 2.8 m, keystones / pediments on the noble floor |
| `medieval-timber` | stone ground floor, jettied plaster floors with oak framing, steep tiled gable | jetty 0.4 m front/back, bays 2.3 m, pitch 52° |
| `paris-haussmann` | cream ashlar, arched ground floor, iron balconies on the 2nd and 5th floors, zinc mansard | ground 4.6 m, upper 3.2 m, bays 3.0 m |
| `modern` | white render, large dark-framed windows, concrete base, flat roof with parapet | bays 3.2 m, windows 2.0–2.4 m |

A new style is data: `style: { extends: 'georgian', roof: { type: 'gable', pitch: 40 },
finishes: { wall: { kind: 'plaster', color: '#e8e1d2' } } }`. Add it to
`studio/kit/building-styles.js` when it should be reusable.

Skins: finishes come from params, so skins can recolor and swap finish kinds (brick → plaster),
but keep every `tile` fixed: UVs must not depend on skin params (rule 16).

## 10. From a reference photo

When the user gives a picture of a house:

1. **Read the photo before coding** and write it into `meta.interpretation`:
   - **Masses:** the main block and every wing, porch, tower stub (width × depth estimated from the
     bays: 2.5–3.2 m per bay in classical buildings, 2–2.5 m in vernacular ones). Wings set back or
     forward?
   - **Floors:** count rows of windows; dormers mean an attic in the roof.
   - **Bays per side:** count window columns on each visible side; note blank bays (`blank: { front: [0, 6] }`).
   - **Roof:** type per mass (gable ends visible = `gable`, sloping on all sides = `hip`, steep
     lower + flat top = `mansard`), pitch, dormers, chimneys (count, where).
   - **Style and details:** window shape and heads, quoins, bands, cornice, shutters, balconies,
     timber framing, jetty, portico or porch.
   - **Finishes:** wall, trim, roof, frame and door colors (sample them from the photo).
2. **Pick the closest style** and override only what differs (`style: { extends: …, … }`).
3. Save the photo as `assets/<slug>/reference.png` (a straight front view works best) and set
   `meta.reference: { image: 'reference.png', view: 'front' }`. Each review overlays the model on
   it (`reference.png`, IoU); fix widths, floor heights and roof pitch until the silhouette matches,
   then compare window rows and columns by eye.
4. Features the generator does not have yet (round towers, bay windows/oriels, verandas, curved or
   upturned roofs, balustrades) are built in the asset next to the building with sections 1–8 and
   rule 17, placed with the plan data (`house.plan.masses`, `k.arch.massRect(mass, floor)`). Say
   which parts you added by hand.
