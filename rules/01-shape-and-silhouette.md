# 01 — Shape and silhouette

Players recognize an object by its silhouette long before they see any detail. Get the big
shapes right first; everything else is decoration.

## Work big to small

1. **Primary forms** — the 1–3 volumes that define the object (a barrel's bulging body, a
   chair's seat + back, a lamp's post + lantern). Block them with simple primitives and check
   the review sheet before adding anything else.
2. **Secondary forms** — parts that change the silhouette or read from mid distance (hoops,
   handles, roof overhangs, legs, crenellations).
3. **Tertiary detail** — small things seen up close (rivets, bolts, grooves, scratches). Many
   of these belong in textures or can be skipped (see 03).

## Readable silhouettes

- Check the **front, side and top** views of the review sheet: each should be recognizable as
  a flat black shape. If the front and side look the same, add depth variation (overhangs,
  taper, offsets).
- Prefer **clear, varied proportions** (big/medium/small) over evenly sized parts. Repeating
  the same size everywhere reads as noise.
- **Break perfect symmetry** slightly when the prompt allows it (a 2–5 % lean, jittered
  planks, uneven wear). Perfect CG symmetry looks synthetic; heavy asymmetry looks broken.
- Leave **negative space** where the design has it (between chair rails, under a table,
  inside a lantern frame). Filling everything in reads as a block.

## Shape language (only when the prompt doesn't decide)

| Shape | Reads as | Typical use |
| --- | --- | --- |
| Circles, soft bevels | friendly, cozy, safe | cartoon, cozy, kids |
| Squares, chamfers | stable, sturdy, built | crates, buildings, sci-fi cases |
| Triangles, points | danger, energy, speed | crystals, spikes, weapons |

Mix one dominant shape with one supporting shape. The prompt's style words override this table.

## Edges catch light

Real objects never have perfectly sharp edges. A bevel/chamfer of 1–5 % of the part size makes
an edge catch a highlight and read clearly in every engine. Use `bevel` on `k.geo.box`,
`cylinder`, `washer`, `extrude`; leave edges sharp only where the style asks for it (crisp
low-poly) or the part is tiny.

## Quick test

Squint at the iso view of the sheet (or view it small). If you can still tell what it is and
what is in front, the shapes work. If it turns into a blob, fix primary forms before
continuing.
