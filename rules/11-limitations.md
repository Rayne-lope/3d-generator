# 11 — Limitations: say it, don't fake it

Procedural code is strong at hard-surface objects, props, architecture, modular and
environment pieces, and stylized objects. It is **not** a sculpting tool.

## Weak areas

- High-quality organic characters and creatures (faces, anatomy, muscles, cloth folds).
- Realistic foliage with thousands of leaves, realistic hair/fur.
- Rigging, skinning, animation (out of scope for V1).
- Photogrammetry-like realism (scanned rock detail, film-quality surfaces).

## What to do when a prompt lands there

1. **Tell the user plainly** in your reply, before building: what will work and what won't, e.g.
   "A realistic dragon is outside what procedural modeling does well; I can make a stylized /
   low-poly dragon statue, or a blocky toy dragon. Which do you prefer?" If the user already
   chose, build the closest strong interpretation.
2. **Offer a strong alternative** that plays to the strengths: stylized/low-poly figures,
   statues, toys, mascots made of primitives, silhouettes on signs, creatures as props
   (skeletons, statues, trophies).
3. Never claim parity with sculpted assets. In `meta.interpretation`, describe exactly what was
   built.

## Large environments

Whole landscapes belong in the engine's terrain tools (Roblox Terrain, Godot terrain plugins).
Build **pieces** here: terrain tiles, cliffs, rocks, trees, buildings, modular walls (see 12).
