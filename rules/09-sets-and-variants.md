# 09 — Sets and variants

## Variants: many versions of one asset

Use `variants` when the pieces share one construction: rocks A/B/C, intact/broken, open/closed,
small/large, color schemes.

```js
params: { height: 1, damage: 0, lidOpen: 0 },
variants: {
  small: { height: 0.7 },
  broken: { damage: 0.7, seed: 977 },   // a different seed re-rolls random detail
  open: { lidOpen: 1.1 },
},
```

- Each variant exports as `<slug>--<variant>.glb` and appears in the viewport variant bar.
- Variants are param overrides only — no separate code paths that drift apart.
- Seed-only variants (`a: { seed: 1 }, b: { seed: 2 }`) are the fastest way to get a natural
  set of unique rocks, trees or crates.
- `node studio review <slug>` renders every variant plus a lineup at true relative scale.

## Sets: a pack from one prompt

Use a set when the prompt asks for **different objects in one style** ("tavern props: table,
stool, mug, candles, shelf").

```bash
node studio new-set tavern --members table,stool,mug --prompt "<prompt>" --style stylized,cozy
```

1. Decide the shared style first in `sets/<set>/style.js`: palette, materials, bevel size,
   board thickness, metal treatment, shared helpers (e.g. `planks()`), and shared dimensions
   (seat 0.45, table 0.76) so members fit each other.
2. Build each member importing that module; no member defines its own palette.
3. `node studio review set:<set>` → check the lineup: consistent scale relationships, same
   edge softness, same material values, no member louder than the others unless it is the focal
   piece.
4. `node studio save set:<set> -m "<prompt>"` saves the style module and every member together.

A change to `style.js` rebuilds every member in the live viewport.

## Consistency checklist for packs

- Same bevel size and shading mode across members.
- Same wood/metal/stone materials (shared objects from `materials(k)`).
- Human-scale relationships hold (stool fits the table, mug fits the hand).
- Triangle density similar per meter of surface.
- One naming scheme: `<set>-<member>`.
