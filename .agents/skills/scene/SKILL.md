---
name: scene
description: Compose a scene (a room or small environment) from existing studio assets, written as plain data in scenes/<name>/scene.json (room size, door and window openings, placed assets with position and yaw), checked from a rendered review sheet and exported as one GLB in which every placed asset stays its own node. Use when the user asks for a room, lobby, interior, map piece or layout assembled from the asset library.
metadata:
  argument-hint: "<prompt describing the room and what goes in it>"
---

# Compose a scene from library assets

Input: the user's prompt for the room or environment.

Follow **Workflow H** (`AGENTS.md`) and `rules/18-scene-layout.md`. A scene only **places**
assets that already exist; it never contains modeling code.

1. Reply with your interpretation in 1–2 sentences: the room size in meters (and studs when
   the target is Roblox), the openings, and which assets go where.
2. `node studio scene library --json` (add `--set <set>` or `--category <c>` to narrow it):
   pick assets by their **real size** (`size.meters` is width × height × depth; `size.bounds`
   is the box around the asset's origin, which sits at its base center). If an asset the scene
   needs does not exist, say so and offer to make it with the asset workflow first; do not
   substitute something unrelated. `built: false` means no preview yet: run
   `node studio build <slug>` to get its size.
3. `node studio scene new <name> --room <W>x<D>x<H> --title "<title>" --prompt "<the prompt verbatim>"`
   (`--room none` for an open layout without a shell).
4. Edit `scenes/<name>/scene.json`: fill `interpretation`, the room `openings` and `finishes`,
   and the `instances`. Coordinates are meters, the room is centered on the origin with the
   floor at y = 0, walls are `front` (+Z), `back` (−Z), `left` (−X), `right` (+X). Each
   instance is `{ id, asset, variant, skin, position: [x, y, z], yaw }`; `yaw` is degrees
   around +Y and 0 means the asset's front faces +Z. Never scale: assets keep their real size.
   Give instances that form one unit the same `group` name (a table with its chairs, two racks
   back to back); compute rows and aisles from the sizes instead of placing by eye.
   Compute positions from the bounds (an asset whose back is on the back wall sits at
   `z = -depth/2 - bounds.min[2]` with yaw 0).
5. `node studio scene review <name>` → open the printed sheet PNG with your image tool and
   **look** at it: the labeled plan, both dollhouse views and both eye-level views. Fix what
   is wrong (blocked door, furniture floating or sunk, things outside the room, no walkway)
   and review again. `scene.outside-room` warnings and any error must be resolved;
   `scene.overlap` notes are fine when intended (a stool pushed under a table).
6. `node studio scene save <name> -m "<the prompt verbatim>"`.
7. Reply with the room size, what was placed (count per asset), the scene totals (triangles,
   meshes) and anything missing from the library. Mention that the Scenes tab of
   `node studio dev` shows it live and lets the user drag things around, and that
   `node studio scene export <name> --profile <engine>` writes the engine file.
