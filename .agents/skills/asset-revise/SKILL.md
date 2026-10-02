---
name: asset-revise
description: Revise an existing studio asset with the smallest possible change, verified with a visual diff, then saved as a new version. Use when the user asks to change, adjust, enlarge, recolor, add to or fix an asset that already exists in assets/.
metadata:
  argument-hint: "<slug> <what to change>"
---

# Revise an asset

Input: the asset slug (or `set:<name>`) followed by the user's revision request.

Follow **Workflow B** (`AGENTS.md`) and `rules/10-revisions.md`:

1. `node studio history <slug>`. If the working copy has unsaved changes, ask before mixing them in.
2. Locate the param or part the request touches in `assets/<slug>/asset.js`. Make the smallest
   change: params first; add a new param for a new axis of variation (e.g. `wear`, `damage`);
   edit only the affected part's code. Never change the seed or rename rng streams, keep
   existing loops drawing the same random numbers in the same order, and never rebuild the asset
   from scratch.
3. `node studio diff <slug>` → open the diff sheet with your image tool. Red (shape or strong
   change) must appear only where the request applies; orange (subtle color/shading) only for
   color, wear or material requests. If other areas changed, find out why and fix it.
4. `node studio review <slug>` → open the sheet → fix anything the change broke (0 errors).
   For shape or proportion requests also open `blueprint.png` (and `reference.png` when the
   asset has one) to confirm the numbers moved the way the user asked.
5. `node studio save <slug> -m "<the revision request verbatim>"`.
6. Reply: what changed (params/parts, stats delta from the diff), and mention that the
   asset-undo command (`/asset-undo` or `$asset-undo`) brings back the previous version.
