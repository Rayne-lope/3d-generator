---
description: Create a new 3D asset from a prompt (procedural Three.js → GLB)
argument-hint: <prompt describing the asset>
allowed-tools: Bash(node studio:*), Read, Write, Edit, Glob, Grep
---

Create a new game asset for this prompt:

> $ARGUMENTS

Follow **Workflow A** in `AGENTS.md` exactly:

1. Reply with your interpretation in 1–2 sentences (style, real-world size, key parts). If part
   of the request is beyond procedural modeling (`rules/11-limitations.md`), say so now.
2. Pick a short kebab-case slug and run
   `node studio new <slug> --prompt "<the prompt verbatim>" --category <category> --style <style,words>`.
3. Read `rules/01`–`06`, the rule files for the asset type (12 terrain, 13 buildings, 14 nature,
   08 for the style words) and `docs/KIT.md`.
4. Write `build()` in `assets/<slug>/asset.js`: primary forms → secondary → tertiary detail.
   Revisable numbers go in `params`. Moving parts get `{ separate: true, pivot }`. Fill
   `meta.interpretation` and `meta.budget`.
5. `node studio review <slug>` → open the printed sheet PNG with Read → go through
   `rules/checklists/review.md` → fix → review again (usually 1–3 rounds). 0 errors required.
6. `node studio save <slug> -m "<the prompt verbatim>"`.
7. Reply: what you built (parts, size in m, triangles), anything you could not do, and 2–3 useful
   next revisions. Mention that the viewport (`node studio dev`) shows it live.
