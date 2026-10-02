# 15 — Weapons (core essentials)

Weapons are hero props: players see them up close in first person and as tiny silhouettes in
third person or as pickups. They must read from the side profile at a glance, hold up close,
and come apart where animations need it. This guide is about game-ready props; the prompt still
decides the style (realistic, stylized, toy, sci-fi).

## 1. Orientation, origin and size

- **Side profile in the front view.** Lay long weapons along X (muzzle or blade tip toward +X),
  with the side players see most (for firearms, the right side with the controls) facing +Z.
  The review's `front` view then shows the full profile and `iso` the classic 3/4 view. Write
  the convention in `meta.interpretation` so engine setup knows it.
- **Origin:** `base-center` for props that lie or stand in the world (pickups, racks, displays).
  For a held item, the engine sets the grip offset (Roblox `Tool.Grip`, a Godot hand marker);
  mention where the grip is.
- **Real sizes** (meters, overall length unless stated; stylized prompts may exaggerate them):

| Weapon | Size |
| --- | --- |
| Pistol | 0.18–0.22 (height ~0.13) |
| Revolver | 0.23–0.30 |
| SMG | 0.45–0.65 |
| Assault rifle / carbine | 0.85–1.0 / 0.75–0.85 |
| Sniper rifle | 1.1–1.3 |
| Shotgun | 0.95–1.2 |
| Rifle magazine (curved, 30 rds) | 0.18–0.25 long |
| Knife / dagger | 0.2–0.35 |
| One-handed sword / two-handed | 0.9–1.0 / 1.2–1.5 |
| Axe (one-handed) / battle axe | 0.6–0.9 / 1.0–1.3 |
| Spear / staff | 1.8–2.4 / 1.5–1.9 |
| Bow (long / short), arrow | 1.5–1.8 / 1.0–1.3, 0.7–0.8 |
| Shield (round) | Ø 0.6–0.9 |

## 2. Silhouette first

- Block the big masses before any detail. Firearms: receiver (center mass), barrel group (long,
  thin), furniture (stock, grip, handguard), magazine. Melee: blade, guard, grip, pommel.
- Get the defining **angles** right; they identify the weapon more than any detail: stock drop,
  grip angle (15–25° back), magazine curve, blade taper, axe beard.
- Keep thin parts readable: barrels ≥ 1.5 cm diameter, levers and guards ≥ 2 mm thick, sights
  that stick out of the silhouette by a few millimeters.
- Check the `top` view too: weapons are thin (rifles 5–8 cm wide), and controls on one side
  (charging handle, selector) give the top view its character.

## 3. Construction recipes (kit)

```js
// side outline drawn in XY (x along the weapon, y up), extruded across Z with rounded edges
const stock = k.geo.extrude(k.shape.polygon(stockPts), 0.026, { axis: 'z', bevel: 0.005, bevelSegments: 2 });
// cross-section drawn in ZY, extruded along X (dust covers, handguards, rails)
const cover = k.geo.extrude(k.shape.rect(0.027, 0.024, { radius: 0.01 }), 0.13, { axis: 'x', bevel: 0.002 });
// round parts along the length
const barrel = k.op.translate(k.op.lieAlong(k.geo.cylinder(0.0092, 0.35, { segments: 20 }), 'x'), 0.24, 0);
```

- **Curved magazines:** back and front edges as arcs around one center (constant depth), the
  floor plate rotated to the bottom edge. Blades: an outline extruded thin, edges tapered with
  `k.op.taper` or a bevelled profile.
- **No collinear outline points.** Three points on one straight line make a zero-area cap
  triangle, which breaks tangents on normal-mapped materials (`khronos` error).
- **Bevels:** 1–3 mm on metal parts, 3–6 mm on wood or polymer furniture. Hard 90° edges look
  fake up close.
- **Overlap joins by 1–2 mm** (magazine into the well, stock into the receiver) so no gaps show;
  hide intersections inside solids instead of matching faces exactly.

### Futuristic and complex weapons

Sci-fi guns, blasters and other designed shapes follow `17-complex-shapes.md`: chamfered plates
with `k.shape.chamfered` and openings with `withHoles` (skeleton stocks, guards), layered armor
with `k.shape.offset`, glow strips with `k.shape.polyline`, a receiver from two views with
`k.geo.dualProfile`, shroud transitions with `k.geo.loft`, curved conduits with `k.geo.sweep`,
and the reference overlay loop when the user gives a picture. `assets/energy-rifle` is the
complete example (traced from its `reference.png`, 4 skins).

## 4. Parts and pivots for animation

Separate parts (`k.part(name, { separate: true, pivot })`) only for what an animation moves:

| Part | Pivot |
| --- | --- |
| Magazine | front of the magazine well (rocks out and drops) |
| Bolt / charging handle / pistol slide | its rest position (slides along X) |
| Trigger, hammer | their pin |
| Revolver cylinder | its axis |
| Break-action barrels, folding stock | the hinge pin |
| Bow string | none: bows flex, which procedural meshes can't do (11) |

Everything else stays in non-separate parts, so engines get few meshes (each separate part is
its own mesh, and its own MeshPart in Roblox).

## 5. Detail hierarchy

- **Primary:** masses and angles (above).
- **Secondary (geometry):** sights, bands, rails, trigger guard, controls, muzzle device, mag
  ribs, guard and pommel on melee weapons.
- **Tertiary (painted):** rivets, screws, stamping, grip texture, engravings, wear. Paint them
  in 3D on a height map (rivets at 3D positions, grooves along the grip) and turn it into a
  normal map; it costs no triangles and stays identical across skins (16).
- Keep rest areas: a receiver side with only rivets and one stamped outline reads better than
  one covered in noise.

## 6. Materials and wear

- Metals are 0 or 1. Blued or parkerized steel is **gunmetal**, not black: base around sRGB
  70–90 (`#4e535a`), roughness 0.3–0.5. Pure black metal only reflects the environment and
  turns into a flat silhouette.
- Wood: grain along the length of each piece, two tones (walnut `#7a4524` / `#3b1d0d`),
  roughness ~0.5. Polymer/bakelite: roughness 0.4–0.6, subtle noise.
- **Wear tells the story:** bare metal on convex edges (`bake.edges()` → `p.edge`), more where
  hands and holsters rub (grip, magazine base, muzzle); grime in cavities (`p.cavity`); light
  AO baked into the color (`p.ao`; Roblox has no AO map). Keep wear sparse and broken up by
  noise.
- One material and one atlas for the whole weapon is ideal: finishes live in the color/ORM
  maps, Roblox gets one MeshPart per part instead of per material, and skins become possible.
- Don't copy real manufacturers' logos or markings; invented markings are safer in a published
  game.

## 7. Budgets

| Use | Triangles | Texture |
| --- | --- | --- |
| Pickup / third person | 1.5k–5k | 512–1024 atlas |
| First person | 5k–15k | 1024 (Roblox max) or 2048 elsewhere |

The validator warns per mesh above 10k triangles on Roblox (mobile); the report shows texel
density per texture (a 0.9 m rifle on a 1024 atlas gets ~1100 px/m).

## 8. Skins

Weapons are the classic skin target (camos, platings, neon). Plan for skins from the first
version: unique atlas UVs, finishes per zone (metal / furniture / magazine) chosen by params,
all painted in 3D. See `16-skins-and-textures.md`; the AK demo (`assets/ak-rifle`) is a
complete example.

## 9. In the engine

- **Roblox:** the GLB imports as a Model with one MeshPart per part (body, magazine). For a Tool,
  name the grip part `Handle` (or weld the MeshParts to a Handle part) and set `Tool.Grip`.
  `node studio publish <slug> --roblox --skins` uploads the model and its skins.
- **Godot:** instance the GLB under a `BoneAttachment3D` or hand `Marker3D`; separate parts are
  nodes an `AnimationPlayer` can move (magazine drop, bolt).

## 10. Limits

Hard-surface weapons (boxes, extrusions, cylinders) are a strength of procedural modeling.
Organic or sculpted designs (creature-shaped hilts, ornate fantasy filigree in geometry,
flexing bows) are not: say so and offer a cleaner stylized take (11).
