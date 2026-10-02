# 17 — Complex shapes (hard-surface and smooth forms)

Any asset that is more than boxes and cylinders: sci-fi gear, vehicles and spaceships, drones
and robots, gadgets and appliances, instruments, curved furniture, product-like props. The
prompt still decides the style; this rule is about **how to build the shape** so it reads as
designed, not stiff, and how to check it against a reference picture.

The complete worked example is `assets/energy-rifle` (traced from `reference.png`, every tool
below, 4 skins): read its `build()` before modeling something similar.

## 1. Pick the construction per part

Look at each part in the reference and ask which views describe it.

| The part is… | Build it with |
| --- | --- |
| Defined by one outline (side plates, brackets, stocks, fins, signs) | `k.shape.chamfered` / `rounded` / `spline` → `k.geo.extrude` |
| An outline with openings (skeleton frames, guards, handles, vents) | `k.shape.withHoles(outer, ...holes)`, the holes chamfered or rounded too |
| Defined by two or three views (hulls, bodies, receivers, car shells) | `k.geo.dualProfile({ side, top, end })` |
| A cross-section that changes along its length (noses, shrouds, bottles, tapered housings) | `k.geo.loft([{ at, shape }, …])` |
| A constant cross-section along a curve (rails, handles, pipes, cables, trims) | `k.geo.sweep(shape, path)` or `k.geo.tube` for round ones |
| Round around one axis (knobs, lenses, vases, wheels) | `k.geo.lathe` or `k.geo.cylinder` |
| A layer on top of another (armor plates, inset panels, rims) | `k.shape.offset(outline, -inset)` extruded thin, set 1 mm proud |
| A strip that follows an outline (glow lines, piping, trim, seams you want in geometry) | `k.shape.polyline(points, { width, size })` extruded |
| A recess or cut that no outline describes | `k.csg.subtract` (keep cutters simple) |

## 2. Trace from a reference image

When the user gives a picture (concept art, a photo in side view), trace it instead of guessing.

1. Save it as `assets/<slug>/reference.png` (plain background, side view) and declare
   `meta.reference: { image: 'reference.png', view: 'front' }`. Every review then writes
   `reference.png` in the shots folder: reference | model | overlay, with the silhouette **IoU**.
2. Make a gridded crop to read coordinates (any image tool; ImageMagick works). Read points in
   **image pixels**.
3. Convert pixels to meters with one helper, so every outline scales with one param:

   ```js
   const S = p.length / 1350;                              // meters per reference pixel (1350 px = full length)
   const px = (x, y) => [(x - 25) * S, (330 - y) * S];     // x from the left end, y up from the center line
   const pts = (list) => list.map(([x, y, s, style]) => [...px(x, y), s === undefined ? undefined : s * S, style]);
   const plate = k.geo.extrude(k.shape.chamfered(pts([[100, 295], [300, 295], [318, 330], [100, 440]]), { size: 7 * S }), 0.03, { axis: 'z', bevel: 0.0012 });
   ```

4. Trace part by part (frame, then big plates, then details), each as its own outline. Depth
   (Z) comes from the top view or from common sense (rule 02).

## 3. Why shapes look stiff, and the fix

| Stiff | Designed |
| --- | --- |
| Every corner a sharp 90° | Chamfer or fillet most corners; vary the size (big on masses, small on details) |
| One slab per part, all the same depth | Layers: core body, plates on top (`offset` insets), trims; 2–4 different depths |
| Thin rods and plain boxes for complex parts | Chunky outlines traced from the reference; openings with `withHoles` |
| Glow or trim as flat rectangles | `polyline` strips that follow the plate outlines, with chamfered bends |
| Uniform flat color | Two or three finishes (light plates, dark body, black polymer), edge wear, cavity shading (rule 16) |
| A grip or handle drawn as a box | `spline` outline with a bulge where fingers go |
| Straight cylinder joints | `loft` transitions (square → round), rings and clamps at the joint |

## 4. Recipes

- **Sci-fi hard surface:** chamfers 3–8 mm on a 1 m object (`size` per corner where one should
  stand out); plates 1–2 mm proud of the body; openings echo the outer chamfer; glow strips
  4–8 mm wide, extruded 2 mm deeper than their plate so they show on both faces, in a separate
  emissive material (one per asset); panel seams and vents in the height map, not in geometry.
- **Vehicles and ships:** hull with `dualProfile` (side + top; add `end` for a tapered nose),
  wheel arches with `withHoles` on the side outline, canopies with `loft`, fins and wings as
  extruded outlines. Wheels are separate parts with their pivot on the axle (rule 06).
- **Products and appliances:** soft fillets (`rounded`, size 5–15 % of the part), `spline` for
  organic outlines, `loft` between a rounded rectangle and a circle for necks and spouts,
  `sweep` for handles and cables.
- **Instruments and furniture:** body outline with `spline`, thickness by extrusion with a
  generous bevel, necks and legs with `loft` (thicker at the joint), curved rails with `sweep`.

## 5. The check loop

After `node studio review <slug>`:

1. **sheet.png:** does it read like the prompt? (always)
2. **reference.png** (when there is a reference): red = model only, cyan = reference only. Fix
   the **largest** red or cyan area first: it is usually a wrong outline point or a missing part.
   Aim for IoU ≥ 85 %; IoU only measures the silhouette, so interior detail still needs your
   eyes. The energy rifle went 65 % → 88 % in four rounds.
3. **parts.png:** every `k.part` in its own color with a legend. Use it to find which code made
   a wrong piece and to spot pieces in the wrong part.
4. **blueprint.png:** orthographic views with a metric grid and rulers. Fix proportions with
   numbers ("the stock bottom is at −0.15 m, it should be −0.13 m").
5. **Floating pieces:** the review prints `scene.floating-part` lines (info): a piece that
   touches nothing. Overlap it 1–2 mm with what it attaches to, unless it floats on purpose.

## 6. Pitfalls

- `dualProfile`: chamfer or round **one** view and keep the other a plain polygon. Chamfers
  crossing in both views make tiny CSG faces that break UV padding.
- A concave notch in a `dualProfile` outline works, but a separate plate is often simpler and
  gives cleaner UVs.
- `offset` is for insets that are small next to the shape (a few mm on a 10 cm plate).
- Holes must stay inside their outline and must not be covered by another part; check the
  overlay, because a hole hidden under a grip or a body looks filled.
- Use 3+ sections in a `loft` for a profile that bulges. Two sections give straight sides.
- Join parts by overlapping 1–2 mm, never by touching faces exactly (z-fighting, gaps).
- `rounded`/`chamfered` remove collinear points for you; plain `k.shape.polygon` does not, and
  a collinear point there gives a zero-area cap triangle (tangent error, rule 15).

## 7. Limits

These tools are for designed, hard-surface and smooth product shapes. Organic sculpted forms
(faces, creatures, muscles, cloth folds, realistic trees) still need sculpting: say so and offer
a stylized take (rule 11).
