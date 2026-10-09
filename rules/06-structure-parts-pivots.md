# 06 — Structure, parts and pivots

Assets are code; good structure makes revisions surgical and engine use painless.

## File layout

- One asset = `assets/<slug>/asset.js`, `export default defineAsset({ meta, seed, params, variants, build })`.
- Slugs: lowercase, digits, single dashes (`wooden-barrel`, `scifi-door-large`).
- Extra helpers for one asset may live next to it (`assets/<slug>/parts.js`). Shared style for
  a pack lives in `sets/<set>/style.js`. Never edit `studio/` while making assets.

## meta

```js
meta: {
  title: 'Wooden Barrel',
  prompt: '<the user prompt, verbatim>',
  interpretation: '<1–2 sentences: style, real size, key features>',
  style: ['stylized'],             // style words from the prompt
  category: 'container',           // prop | furniture | container | architecture | environment | nature | vehicle | weapon | lighting | decor | modular
  budget: { triangles: 5000 },
  origin: 'base-center',           // or back-center | center | none
  set: 'tavern',                   // only for set members
}
```

## params, seeds, determinism

- Every number a user might revise goes into `params`: sizes, counts, angles, colors, wear.
  Revisions then change params, not code.
- Randomness only through the seeded `rng` from `build({ rng })`, split into named streams per
  part: `const pr = rng.stream('planks')`. Changing the hoop code then never reshuffles the
  planks. `Math.random`, `Date` and Node APIs are rejected by the source lint.

## Parts

- Group meshes into named parts: `k.part('body')`, `k.part('hoops')`. Names show up in triangle
  reports and diffs.
- Default parts are merged per material into one `body` mesh at export (efficient).
- **Separate parts** — `k.part('lid', { separate: true, pivot: [x, y, z] })` — become their own
  node with the origin at `pivot`. Use them for anything that moves or detaches: lids, doors,
  drawers, wheels, flags, valves. Author the part's meshes in asset coordinates; rotating the
  part (`lid.rotation.x = -1.1`) rotates around the pivot, which is how an `open` variant works.
- Put the pivot exactly on the physical hinge/axle (back top edge of a chest lid, door hinge
  side, wheel center).

## Attachments and collision

Engines need two things a mesh cannot say (API in `docs/KIT.md`):

- **Attachment points** (`k.attach(name, { at, forward })`) wherever something connects: the
  `grip` and `muzzle` of a weapon, the `magwell`, a lamp's `light` point, a `seat`. Add them to
  the part they belong to, so they move with it. Do not put them on a part that animates away
  from the point (a muzzle belongs on the frame, not on a slide that cycles). `forward` is the
  direction the thing points; when it does not point anywhere, use the asset's own forward.
- **Collision** for anything a player walks into or stands on: a few `k.collider.box / sphere /
  cylinder` shapes that cover the silhouette (table: top + legs or trestles; shelf: one box;
  arch: two posts + lintel, so it stays walkable). `meta.collision: 'bounds'` is enough for
  simple props and hand-held items; `'none'` for small decor players should pass through.
  Leave both out and the engine uses its default collision.

Check `markers.png` from the review: shapes hug the model, attachments sit where they should
and their blue line points the right way.

## Orientation and units

Meters, +Y up, front +Z. Build around the origin; the runtime moves the origin to
`meta.origin`. Use `k.op.lieAlong(g, 'x' | 'z')` to lay Y-axis geometry (lathes, cylinders,
vault shells) horizontally — it is a pure rotation and keeps the lathe's front side on top.
