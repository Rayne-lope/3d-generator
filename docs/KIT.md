# Kit reference

The kit (`studio/kit/`) is everything an asset is made with. It runs unchanged in Node (export)
and in the browser (parity renders). It uses no Node built-ins, randomness only through the seeded
`rng`, and only materials that survive glTF export.

Units are **meters**. **+Y is up** and the asset's **front faces +Z**. By default the origin is
the **base center**: the lowest point at y = 0, and x/z at the center of the footprint.

- [Asset module](#asset-module) · [Structure](#structure) · [Materials](#materials) · [Color](#color)
- [Geometry](#geometry) · [2D shapes](#2d-shapes) · [Operators](#operators) · [UVs](#uvs) · [Textures](#textures) · [3D painting and skins](#3d-painting-and-skins)
- [CSG](#csg) · [Terrain](#terrain) · [Architecture](#architecture) · [Units](#units) · [Randomness and noise](#randomness-and-noise)
- [Sets](#sets-shared-style) · [Complete example](#complete-example) · [Errors you may see](#errors-you-may-see)

---

## Asset module

`assets/<slug>/asset.js` (create it with `node studio new <slug>`):

```js
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Stylized Wooden Barrel',
    prompt: 'A stylized wooden barrel with chunky iron hoops',   // verbatim user prompt
    interpretation: '1 m barrel, 14 staves, bulging belly, four thick hoops, flat colors.',
    style: ['stylized', 'cartoon'],
    category: 'container',     // prop | furniture | container | architecture | environment | nature | vehicle | weapon | lighting | decor | modular
    budget: { triangles: 6000 },
    origin: 'base-center',     // base-center (default) | center | back-center | none
    set: 'tavern',             // only for set members
  },
  seed: 1234,                  // change only when the user wants a different random result
  params: { height: 1.0, staves: 14, bulge: 0.12 },   // every revisable number
  variants: {                  // each becomes <slug>--<name>.glb
    small: { height: 0.6 },
    other: { seed: 99 },       // seed-only variant
  },
  skins: {                     // surface-only looks on the same mesh: <slug>@<name>.glb
    dark: { woodColor: '#4a2c18' },
  },
  build({ p, k, rng, noise, THREE, variant, skin }) {
    const asset = k.asset('barrel');
    // ... add parts and meshes ...
    return asset;              // must return the k.asset() root
  },
});
```

| `build()` argument | What it is |
| --- | --- |
| `p` | frozen params: defaults ← variant ← skin overrides |
| `k` | the kit namespace (this document) |
| `rng` | seeded random generator. Use **named streams** per part: `rng.stream('planks')` |
| `noise` | seeded noise (`noise.fbm2(x, y)`, …) |
| `THREE` | three.js, for vectors and matrices (not for materials or geometry generators) |
| `variant` | the variant name or `null` |
| `skin` | the skin name or `null` (the default look). Read params instead of branching on the name |

## Structure

| Call | Result |
| --- | --- |
| `k.asset(name)` | The root. Add parts and meshes to it and return it. |
| `k.part(name)` | A named group. Non-separate parts are **merged per material** into the `body` mesh at export, which is efficient. |
| `k.part(name, { separate: true, pivot: [x, y, z] })` | Its own node in the GLB, with its origin on `pivot` (a hinge, axle or detach point). Children are authored in asset space; the kit routes them through the pivot. Use it for lids, doors, wheels, drawers. |
| `k.mesh(geometry, material, { at, rot, scale, name })` | A mesh. `at` = position, `rot` = Euler XYZ radians, `scale` = number or `[x, y, z]`. Negative scale throws (use `k.op.mirror`). |
| `k.group(name)` | A plain group for arranging (merged like a non-separate part). |
| `k.ring(count, radius, (i, angle) => object)` | Copies around the Y axis. Return the object as if it sat at angle 0 on +X. |

Animate a separate part in-engine by rotating its node. For a preview, use a param:
`if (p.lidOpen) lid.rotation.x = -p.lidOpen;`

## Materials

Only glTF metallic-roughness materials are exportable. Anything else throws with a hint.

```js
k.mat.pbr({
  name: 'oak',                 // material name in the GLB (keep it meaningful)
  color: '#8a5a36',            // sRGB authoring color
  roughness: 0.7,              // 0..1
  metalness: 0,                // 0 or 1 for real materials (in-between warns)
  emissive: '#ffb347', emissiveIntensity: 1,   // >1 needs KHR_materials_emissive_strength (not on Roblox)
  map, normalMap, normalScale, ormMap, emissiveMap,  // painters from k.tex (see Textures)
  alpha: 'opaque',             // 'opaque' | 'mask' (+ alphaCutoff) | 'blend' (avoid)
});
k.mat.physical('steel', { color: '#a9adb1', roughness: 0.48, name: 'galvanized_steel' });
```

`k.mat.physical(kind, overrides)` gives physically plausible starting values. They are a
starting point, not a style. Kinds: `wood, painted-wood, varnished-wood, stone, concrete, brick,
plaster, plastic, hard-plastic, rubber, fabric, leather, ceramic, clay, paper, wax, foliage, bark,
crystal, ice, rust, iron, dark-iron, steel, aluminium, brass, bronze, copper, gold, silver, glow`.

Materials are always single-sided (engines cull back faces). Stylized "painted metal" usually
reads better with `metalness: 0`: a polished metal (`metalness 1`, low roughness) renders dark
without reflections, and the validator warns about it (`material.needs-reflections`).

## Color

`k.color(input)` parses `'#rrggbb'`, `[r, g, b]` (0..1 sRGB) or a number into a THREE.Color.
Helpers: `k.color.hex(c)`, `k.color.srgb(c)`, `k.color.mix(a, b, t)`, `k.color.shade(c, amount)`
(− darker / + lighter), `k.color.saturate(c, amount)`, `k.color.hsl(h, s, l)`,
`k.color.luminance(c)`.

```js
const worn = k.color.hex(k.color.mix(p.wood, '#2a1a10', p.wear * 0.35));
```

## Geometry

All generators return non-indexed `BufferGeometry` with normals and UVs (box-projected in meters
unless noted). Common options: `base: true` puts the bottom at y = 0 (otherwise centered),
`uvScale` scales UVs, `crease` is the angle in degrees above which edges stay sharp, and
`flat: true` gives faceted shading.

| Generator | Notes and options |
| --- | --- |
| `k.geo.box(w, h, d, { bevel, smooth, segments, base })` | Chamfered box (`bevel` in m); `smooth: true` = rounded box. |
| `k.geo.cylinder(r, h, { radiusTop, segments, bevel, bevelSegments, caps, base, flat })` | Also truncated cones. |
| `k.geo.cone(r, h, opts)` | |
| `k.geo.prism(sides, r, h, opts)` | Hexagonal posts, octagonal pillars. |
| `k.geo.washer(rOuter, rInner, h, { segments, bevel, base })` | Hoops, bands, rings with thickness (height along Y). |
| `k.geo.torus(R, r, { radialSegments, tubularSegments, arc, axis: 'y' \| 'z' })` | `'y'` lies flat, `'z'` stands facing +Z. |
| `k.geo.sphere(r, { widthSegments, heightSegments, hemisphere, flat, base })` | |
| `k.geo.icosphere(r, detail, { flat = true, base })` | Even faceting (low-poly). |
| `k.geo.capsule(r, length, { capSegments, radialSegments, base })` | Along Y. |
| `k.geo.lathe(profile, { segments, phiStart, phiLength, closed, crease, flat })` | Revolve `[[radius, y], …]` (bottom → top) around Y. Start and end at radius 0 to close the caps. A partial `phiLength` + `closed` gives shells (vault lids). |
| `k.geo.tube(points, radius, { segments, radialSegments, closed, caps, tension })` | Smooth tube through `[[x, y, z], …]` (pipes, handles, scrolls, branches). |
| `k.geo.extrude(shape, depth, { bevel, bevelSegments, curveSegments, axis, base })` | Extrude a `k.shape`. `axis: 'z'`: XY shape extruded along Z (centered). `'y'`: shape lies flat, extruded upward from y = 0. `'x'`: along X. |
| `k.geo.wedge(w, h, d)` | Ramp rising toward −Z. |
| `k.geo.plane(w, d, { segmentsW, segmentsD })`, `k.geo.disc(r)` | Single-sided, facing +Y. Only where the underside is never seen. |
| `k.geo.rock(r, { detail, roughness, squash: [x, y, z], seed, flat, frequency, base })` | Noise-displaced icosphere. |
| `k.geo.plank(w, h, d, { bevel, seed, warp, base })` | A board with a tiny random warp, so rows don't look cloned. |
| `k.geo.terrain(opts)` | See [Terrain](#terrain). |

## 2D shapes

For `k.geo.extrude` (units in meters):

`k.shape.rect(w, h, { radius })`, `k.shape.circle(r, segments)`, `k.shape.polygon([[x, y], …])`,
`k.shape.ngon(n, r, rotation)`, `k.shape.arch(w, h)`, `k.shape.star(n, rOuter, rInner)`,
`k.shape.gear(teeth, rOuter, rRoot, { toothFraction })`, `k.shape.moveShape(shape, dx, dy)`,
`k.shape.withHoles(shape, ...holes)`.

```js
const sign = k.geo.extrude(k.shape.withHoles(k.shape.rect(0.6, 0.4, { radius: 0.05 }), k.shape.circle(0.05)), 0.03, { bevel: 0.004 });
```

## Operators

Operators return geometry (most return a new one).

| Operator | Use |
| --- | --- |
| `k.op.translate(g, x, y, z)`, `rotate(g, x, y, z)`, `scale(g, x, y, z)`, `transform(g, m4)` | Negative scale and mirrored matrices are fixed safely (winding flipped). |
| `k.op.mirror(g, 'x' \| 'y' \| 'z')` | Mirrored copy with outward faces. |
| `k.op.lieAlong(g, 'x' \| 'z')` | Lay a Y-axis object (lathe, cylinder) along X or Z. A lathe's front (+Z) goes on top, so a partial lathe becomes an upward vault. |
| `k.op.merge(...g)`, `k.op.clone(g)` | |
| `k.op.center(g, { y: 'center' \| 'base' \| 'top' })`, `k.op.sit(g)`, `k.op.bounds(g)` | |
| `k.op.crease(g, angle)`, `k.op.flat(g)`, `k.op.smooth(g)`, `k.op.reshade(g)` | Shading. `crease` is the main tool and works on tiny parts too. |
| `k.op.taper(g, { axis, from, to, curve })`, `bulge(g, { axis, amount, power })`, `twist(g, { axis, angle })`, `bend(g, { axis, toward, angle })` | Deformers (normals follow). |
| `k.op.noise(g, { amount, scale, octaves, seed, ridged })`, `jitter(g, { amount, seed })`, `dent(g, { at, radius, depth })`, `displace(g, fn)` | Organic irregularity and damage. |
| `k.op.keepFaces(g, (centroid) => bool)` | Keep only triangles whose centroid (a Vector3) passes: drop hidden faces, or split a surface by height (moss, snow caps). |
| `k.op.flipWinding(g)` | Back side for cards (leaves, banners). |

## UVs

| Call | Use |
| --- | --- |
| `k.uv.box(g, { scale, offset })` | Box projection in meters (the default for most generators). `offset` decorrelates repeats. |
| `k.uv.planar(g, { axis, scale })`, `k.uv.cylindrical(g, { axis, scale, radius })` | |
| `k.uv.scale(g, su, sv)`, `k.uv.offset(g, du, dv)`, `k.uv.rotate(g, angle)` | Rotate to run wood grain along a board, straw down a roof. |
| `k.uv.fit(g, { margin })` | Normalize to 0..1 (one image over the whole part). |
| `k.uv.unwrap(g, { scale })` | Split into charts by face direction, for atlases. |
| `k.uv.atlas({ name: g, … }, { size, padding, pxPerMeter })` | Pack charts of several geometries into one texture with uniform texel density and `padding` px gutters. Rewrites UVs and returns a layout: `layout.rect('name', '+z')` gives the largest pixel rect of an entry (optionally facing an axis), and `layout.rects('name')` gives all of them. Paint into a rect with `painter.clip(rect, (sub) => sub.fill(…))`. |

Two texture layouts:

- **tiling**: textures repeat (UVs in meters, `wrap: 'repeat'`). Best for wood, stone,
  plaster and terrain. UV padding doesn't apply. The Roblox profile bakes the repeats into a
  0..1 image automatically and reports the resulting texel density.
- **atlas**: unique painting per part (`layout: 'atlas'` on the painter + `k.uv.atlas`). Padding
  matters: ≥ 8 px on Roblox at the final size. The exporter also dilates island edges into the
  gutters.

## Textures

`k.tex.create(width, height, { space: 'srgb' | 'linear', layout: 'tiling' | 'atlas', tileable, seed, name })`
returns a **painter**. All methods chain and work in UV units (0..1). Tileable painters wrap at
the edges.

| Method | Paints |
| --- | --- |
| `fill(color, alpha)` | the whole texture |
| `noise({ color, scale, octaves, amount, type: 'fbm' \| 'ridged' \| 'cells' \| 'cell-edges', stretch: [su, sv], mode })` | noise-masked color; `stretch` gives streaks (`[1, 10]` = long along v) |
| `gradient({ from, to, direction: 'v' \| 'u' \| 'radial', amount, mode })` | gradients |
| `rect`, `circle`, `line` | shapes (`soft` edges, blend `mode`) |
| `stripes`, `checker`, `tiles`, `bricks({ rows, cols, mortar, mortarColor, vary, offset })`, `planks({ count, axis, gap, gapColor, vary, joints })` | patterns |
| `grain({ color, rings, warp, scale, axis, fine })` | wood grain |
| `scratches`, `stains`, `rust({ amount, scale, color, rim })`, `dirt({ color, amount, from: 'bottom' \| 'top' })`, `edges` | wear |
| `panelLines({ rects \| grid })`, `rivets({ points })` | hard-surface details |
| `blur(px)`, `levels({ brightness, contrast, saturation, gamma })`, `map(fn)` | adjustments, per-pixel functions |
| `clip(rect, (sub) => …)` | paint inside a pixel rect (from an atlas layout) or a UV rect `[u0, v0, u1, v1]`, with local UVs |

Blend modes: `normal`, `multiply`, `add`, `screen`, `overlay`, `subtract`, `max`, `min`. For
linear painters (height, roughness), colors are plain numbers 0..1.

```js
const T = 512;
const color = k.tex.create(T, T, { name: 'pine', seed: 11 })
  .fill('#c39667')
  .grain({ color: '#8a6038', rings: 26, amount: 0.32, warp: 0.45, seed: 7 })
  .stains({ count: 6, color: '#5e4127', alpha: 0.18 });
const height = k.tex.create(T, T, { space: 'linear', name: 'pine_height' })
  .fill(0.6).grain({ color: 0.4, rings: 26, amount: 0.5, warp: 0.45, seed: 7 }).blur(1);
const normal = k.tex.normalFromHeight(height, { strength: 1.4 });        // OpenGL convention
const orm = k.tex.orm({ roughness: 0.75, metalness: 0 });                  // or painters per channel
const wood = k.mat.pbr({ name: 'pine', color: '#ffffff', map: color, normalMap: normal, ormMap: orm });
```

Keep the base color in the texture with `color: '#ffffff'` on the material. Texture size:
pick for ≥ 128 px/m on generic/Godot and ≥ 90 px/m on Roblox (the report shows the density).

## 3D painting and skins

Paint atlas textures as functions of the 3D surface instead of 2D UV space: patterns run across
UV seams and from part to part, and wear follows the real edges of the mesh. This is how skins
are made (see `rules/16-skins-and-textures.md` and the complete example in `assets/ak-rifle`).

```js
const U = { stock: k.uv.unwrap(stockGeo), receiver: k.uv.unwrap(receiverGeo) };   // merge each zone first
k.uv.atlas(U, { size: 1024, padding: 12 });
const bake = k.bake.surface(U)                       // per-texel 3D position, normal, entry
  .edges({ angle: 25, width: 0.0035 })               // p.edge (convex: wear), p.cavity (concave: grime)
  .ao({ distance: 0.03, samples: 16, size: 192 });   // p.ao (1 = open)
const camo = k.tex.pattern.camo({ colors: ['#c9b287', '#a08159', '#73603f'], scale: 0.06, seed: 7 });
const color = k.tex.create(1024, 1024, { layout: 'atlas', name: 'color' }).fill('#444444');
color.paint3d(bake, (p) => {
  const base = p.entry === 'stock' ? camo(p) : [0.3, 0.32, 0.35];
  const worn = p.edge * 0.8;                          // bare steel on edges
  return [base[0] + (0.6 - base[0]) * worn, base[1] + (0.62 - base[1]) * worn, base[2] + (0.65 - base[2]) * worn];
});
```

| Call | What it does |
| --- | --- |
| `k.bake.surface(entries, { size, padding, transforms })` | Rasterizes the atlas UVs of `entries` (the map passed to `k.uv.atlas`) into texels: `mask`, `pos`, `normal`, `entry`. Gutter texels within `padding` px copy their nearest island texel. `size` defaults to the atlas size. Cached by content: skins of one model share it. |
| `bake.edges({ angle, width, sameEntry })` | Edge masks from the mesh: faces meeting at more than `angle`° form sharp edges; `p.edge` is 1 on convex edges fading to 0 at `width` m, `p.cavity` the same for concave edges. |
| `bake.ao({ samples, distance, size, bias, blur })` | Ambient occlusion by ray casting (three-mesh-bvh) at a low resolution, upsampled. |
| `bake.forEach((p) => …)` | Visit every baked texel (precompute arrays, then paint several painters from them). |
| `painter.paint3d(bake, (p) => color \| null, { alpha, mode })` | Paint every baked texel. `p = { pos, normal, entry, edge, cavity, ao, gutter, i, x, y, u, v }` (reused between calls). Return `[r, g, b]` in painter space, `[r, g, b, a]`, a color, or `null` to keep. The painter must be the bake's size. |

Patterns (`k.tex.pattern.*`) return `(p) => [r, g, b]` and can be passed straight to `paint3d`.
Discrete ones also have `.index(p)` and `.colors`.

| Pattern | Options |
| --- | --- |
| `camo({ colors, scale, coverage, warp, detail, seed })` | organic blobs: `colors[0]` is the ground, each next color a layer on top; `scale` = blob size (m); `coverage` = share per layer |
| `digital({ colors, cell, scale, coverage, warp, seed })` | camo sampled on `cell`-sized cubes (pixel camo on every face) |
| `tiger({ colors, spacing, width, scale, axis, seed })` | brush-stroke stripes over a two-tone ground |
| `hex({ colors, size, line, accent, seed })` | hexagon grid projected per face; `accent` = share of cells in `colors[2]` |
| `carbon({ colors, size })` | carbon-fibre 2×2 twill projected per face |
| `brushed({ color, axis, amount, scale, seed })` | brushed-metal streaks along `axis` |

**Skins** are `skins: { name: { ...param overrides } }` next to `variants`. They may only change
the surface: each skin build is compared with the default look, and a different mesh, UVs or
material slots is an error (`skin.geometry-changed`, `skin.materials-changed`). Assets with skins
keep every material apart (even identical ones) and get one Roblox palette swatch per flat
material, so UVs never depend on colors. Build, review and export skins with `--skin <name|all>`,
`review --skins` (skin sheet) and `export --skins` (per-skin GLBs and skin packs).

## CSG

`k.csg.subtract(a, ...cutters)`, `k.csg.union(a, ...others)`, `k.csg.intersect(a, ...others)`
work on geometries. Use CSG for odd openings and cut-outs. For walls with doors and windows,
prefer `k.arch.wall`, which is cleaner and has no slivers.

## Terrain

```js
const t = k.geo.terrain({
  size: [16, 16], segments: 64,
  noise: { amp: 1.2, scale: 0.18, octaves: 5, seed: 3 },       // or height: (x, z, { noise }) => meters
  terrace: { step: 0.6, sharpness: 0.8 },                       // optional stepped plateaus
  flatten: [{ at: [2, -3], radius: 2.5, falloff: 1.5 }],        // building pads, paths
  edge: { falloff: 2, height: 0 },                              // blend to flat ground at the border
  skirt: 0.6,                                                   // closed diorama block (sides + bottom)
  uv: 'fit',                                                    // 'fit' (paint one image) | 'world' (tiling)
  shading: 'smooth',                                            // 'smooth' | 'flat' | crease angle
});
```

The result is `{ top, sides, size, segments, minHeight, maxHeight, bottomY, heightAt(x, z),
normalAt(x, z), slopeAt(x, z), info(x, z), split(fn), paint(painter, fn), scatter(opts) }`:

- `t.split(info => info.slope > 35 ? 'rock' : 'grass')` gives one geometry per key, for crisp
  flat-color zones.
- `t.paint(painter, info => …)` paints a fit-UV texture from height01, slope, normal and position.
- `t.scatter({ count, seed, minDistance, slope: [0, 25], heightRange, avoid: [{ at, radius }] })`
  returns `[{ x, y, z, slope, normal, scale01 }]` for placing trees and rocks.

See `rules/12-environments-and-terrain.md` for composition (paths, clearings, layering).

## Architecture

`k.arch.dims` holds human-scale defaults: door 0.9 × 2.1, window 1.0 × 1.2 (sill 0.9),
storyHeight 3.0, ceilingClear 2.6, wallExterior 0.28, wallInterior 0.12, stairRiser 0.18,
stairTread 0.28, railing 1.0, tableHeight 0.75, seatHeight 0.45, counterHeight 0.9,
humanHeight 1.75.

| Call | Result |
| --- | --- |
| `k.arch.wall({ width, height, thickness, openings, gableHeight })` | A closed wall solid in the XY plane: base at y = 0, x centered, thickness centered on z = 0. `openings: [{ x, y, w, h, shape: 'rect' \| 'arch' }]`; `y = 0` = a door cut from the bottom, otherwise a window hole. Keep ≥ 5 cm between openings and edges. |
| `k.arch.frame({ w, h, border, depth, bottom, shape })` | Trim around an opening (inner size w × h). `bottom: false` for door casings. |
| `k.arch.roof({ type: 'gable' \| 'hip' \| 'shed' \| 'flat', width, depth, pitch \| height, overhang, thickness })` | Roof solid whose outer surface meets the wall line at y = 0, z = ±depth/2. Place it at the top of the walls. The ridge runs along X. |
| `k.arch.stairs({ width, height, depth, steps })` | Solid stairs rising toward −Z. |

See `rules/13-buildings-and-houses.md` for proportions, openings with depth, and roofs.

## Units

`k.units.studs(n)` (studs → m, 1 stud = 0.28 m), `k.units.toStuds(m)`, `k.units.cm(n)`,
`k.units.mm(n)`, `k.units.inch(n)`, `k.units.ft(n)`, `k.units.snap(value, step)`. Author in
meters; the Roblox profile converts to studs on export. For Roblox modular kits, choose module
sizes in whole studs: `k.units.studs(16)` = 4.48 m.

## Randomness and noise

```js
const pr = rng.stream('planks');        // independent, reproducible per part
pr.float(); pr.range(a, b); pr.int(a, b); pr.pick(list); pr.chance(0.3); pr.sign();
pr.vary(1.2, 0.1); pr.jitter(0.01); pr.gauss(0, 1); pr.shuffle(list);
```

Use one stream per part, so changing one part never reshuffles another. When a revision adds
random detail, use a **new** stream and keep the existing loops drawing the same numbers in the
same order.

`noise.perlin2(x, y, px, py)` (optionally periodic), `noise.perlin3`, `noise.fbm2(x, y, { octaves, period })`,
`noise.fbm3`, `noise.ridged2`, `noise.ridged3`, `noise.worley2(x, y, period)` → `{ f1, f2, id }`.
`k.rng(seed)` and `k.noise(seed)` create independent generators.

Other helpers: `k.deg(degrees)` → radians, `k.v3(x, y, z)`, `k.THREE`.

## Sets (shared style)

`sets/<set>/style.js` exports the shared look. Members import it:

```js
// sets/tavern/style.js
export const palette = { wood: ['#a8693a', '#9a5f33', '#b77744'], iron: '#4b4f57' };
export const dims = { tableHeight: 0.76, seatHeight: 0.46 };
export function materials(k) {
  return { woods: palette.wood.map((c, i) => k.mat.pbr({ name: `tavern_wood_${i + 1}`, color: c, roughness: 0.75 })) };
}
export default { palette, dims, materials };

// assets/tavern-stool/asset.js
import style from '../../sets/tavern/style.js';
```

## Complete example

```js
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Wooden Stool', prompt: 'a simple wooden stool', category: 'furniture',
    interpretation: '0.45 m round stool, three splayed legs, one ring of stretchers.',
    style: ['simple'], budget: { triangles: 1500 },
  },
  seed: 7,
  params: { height: 0.45, seatRadius: 0.17, legs: 3, splay: 0.12 },
  build({ p, k }) {
    const asset = k.asset('stool');
    const wood = k.mat.physical('wood', { name: 'wood', color: '#9a6a40' });
    const seat = k.part('seat');
    seat.add(k.mesh(k.geo.cylinder(p.seatRadius, 0.04, { bevel: 0.008, segments: 24 }), wood, { at: [0, p.height - 0.02, 0] }));
    const legs = k.part('legs');
    for (let i = 0; i < p.legs; i++) {
      const a = (i / p.legs) * Math.PI * 2;
      const leg = k.geo.cylinder(0.018, p.height - 0.04, { radiusTop: 0.022, segments: 8, base: true });
      legs.add(k.mesh(leg, wood, {
        at: [Math.cos(a) * p.seatRadius * 0.6, 0, Math.sin(a) * p.seatRadius * 0.6],
        rot: [-Math.sin(a) * p.splay, 0, Math.cos(a) * p.splay],
      }));
    }
    asset.add(seat, legs);
    return asset;
  },
});
```

Then: `node studio review wooden-stool`, open the sheet, fix, and
`node studio save wooden-stool -m "a simple wooden stool"`.

## Errors you may see

| Message | Fix |
| --- | --- |
| `k.mesh: material must come from k.mat.pbr() or k.mat.physical()` | Don't create three.js materials directly. |
| `k.mesh: negative scale is not allowed` | `k.op.mirror(geometry, 'x')`. |
| `material uses a texture … not made with the kit painter` | Textures come from `k.tex.create(...)`. |
| `texture … uses offset/repeat/rotation` | Scale the UVs instead (`k.uv.scale`); texture transforms are not portable. |
| `k.arch.wall: opening … outside the wall` / `openings overlap` | Keep 5 cm between openings and edges. |
| `k.geo.terrain: … too dense` | Lower `segments` or split into tiles. |
| Validator issue ids (`uv.padding`, `scene.mesh-triangles`, `texture.low-density`…) | See `rules/07-export-hygiene.md`, which has a fix for every id. |
