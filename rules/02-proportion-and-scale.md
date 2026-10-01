# 02 — Proportion and scale

**1 unit = 1 meter. +Y is up. The asset's front faces +Z.** Engines place assets next to a
character, so wrong scale is the most visible mistake. The review lineup shows a 1.75 m human.

## Real-world reference (meters)

Use these as defaults; a stylized prompt may exaggerate them on purpose.

| Thing | Size |
| --- | --- |
| Adult human height / eye level | 1.75 / 1.6 |
| Door (single / double) | 0.9 × 2.1 / 1.6 × 2.1 |
| Window sill / window | 0.9 / 1.0 × 1.2 |
| Story height (floor to floor) | 3.0 (2.6 clear) |
| Exterior / interior wall thickness | 0.25–0.35 / 0.1–0.15 |
| Stair riser / tread / width | 0.18 / 0.28 / ≥ 0.9 |
| Railing / balustrade | 1.0 |
| Chair seat height / seat depth | 0.45 / 0.42 |
| Table / counter / bar height | 0.75 / 0.9 / 1.1 |
| Bed (single) | 0.9 × 2.0, top at 0.5 |
| Barrel (wine/beer) | 0.9–1.0 tall, Ø 0.6 |
| 55-gallon oil drum | 0.88 tall, Ø 0.57 |
| Shipping crate (small) | 0.6–1.0 cube |
| Street lamp / lantern | 3–4.5 tall / 0.3–0.5 |
| Mug / bottle | 0.1–0.17 / 0.25–0.33 |
| Sword (one-handed) | 0.9–1.0 |
| Car (compact) | 4.0 × 1.8 × 1.5 |
| Tree (young / mature) | 3–6 / 10–25 |
| Fence | 1.0–1.2 tall, posts 2–2.5 apart |

Roblox measures in studs (1 stud = 0.28 m). For modular Roblox kits, choose module sizes in
whole studs and convert with `k.units.studs(n)` (e.g. a 16-stud wall module = 4.48 m).

## Proportion habits

- Keep **interaction surfaces at human scale** even in stylized assets (seat ~0.45, handles at
  0.9–1.1, doors ≥ 2.0 high) unless the prompt says otherwise. Stylization usually
  exaggerates thickness and roundness, not ergonomics.
- **Thickness sells scale**: real planks are 2–5 cm, metal sheet 1–3 mm (model it at ≥ 3 mm so
  it doesn't z-fight), stone walls 25–60 cm. Too-thin parts make an object look like a toy;
  very thick parts look chunky/cartoon (good when that's the style).
- Put all sizes in `params` (height, radius, counts) so revisions like "make it taller" are a
  one-number change.
- Check `scene.dimensions` warnings: they mean the size is unusual for the category (often a
  units mistake).

## Origin and placement

Default `meta.origin: 'base-center'` puts the origin at the bottom center: the asset sits on
the ground when placed at y = 0. Use `back-center` for wall-mounted items (shelves, signs),
`center` for things that float or get attached by their middle.
