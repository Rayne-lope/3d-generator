---
name: asset-set
description: Create a set (pack) of matching studio assets from one prompt, sharing one style module (palette, materials, bevels, shared dimensions) in sets/<set>/style.js. Use when the user asks for several related assets at once, a kit, a pack or props for one theme.
metadata:
  argument-hint: "<prompt describing the pack>"
---

# Create a set from one prompt

Input: the user's prompt for the pack.

Follow **Workflow D** (`AGENTS.md`) and `rules/09-sets-and-variants.md`:

1. Reply with your interpretation: the set name, the member list (3–8 assets) and the shared style
   (palette, materials, proportions, bevel size, detail level).
2. `node studio new-set <set> --members a,b,c --prompt "<the prompt verbatim>" --style <words>`.
3. Design `sets/<set>/style.js` first: palette, material factories, shared dimensions (e.g. table
   height ↔ stool height), bevel sizes and shared helper functions. Members import it; do not
   duplicate style values inside members.
4. Build each member (`rules/01`–`06` + the relevant type rules), reviewing as you go:
   `node studio review <member>`. Include curated editor controls and stable part IDs by
   default. Moving/detachable parts get `{ separate: true, pivot, id }` and matching
   `editor.parts` metadata; do not split all decoration for the gizmo. Keep shared style
   values in the style module rather than duplicating palette/materials in member controls.
5. `node studio review set:<set>` → open the lineup image with your image tool: same palette,
   same bevels, believable relative scale next to the 1.75 m figure. Fix outliers.
6. `node studio save set:<set> -m "<the prompt verbatim>"`.
   Also save each editor-enabled member with
   `node studio save <member> -m "<the prompt verbatim>" --include-variants` so browser history
   can preview its Base and variants accurately; retain the whole-pack set checkpoint.
7. Reply with the members (size, triangles each) and how they share the style.
