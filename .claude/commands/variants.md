---
description: Add variants of an asset (param/seed overrides exported as separate GLBs)
argument-hint: <slug> <what variants to make>
allowed-tools: Bash(node studio:*), Read, Write, Edit, Glob, Grep
---

Add variants to an existing asset. Arguments: `$ARGUMENTS` (first word = asset slug, the rest
= what the variants should be).

Follow **Workflow C** (`AGENTS.md`) and `rules/09-sets-and-variants.md`:

1. Read `assets/<slug>/asset.js`. Variants are entries in `variants: { name: { ...param
   overrides, seed? } }`. If a variant needs a new axis (color scheme, damage, size class), add a
   param with a default that keeps the base asset unchanged, then override it in the variant.
2. Keep the family recognizable: same construction, same materials logic, different values.
   Seed-only variants are fine for natural assets (rocks, trees).
3. `node studio review <slug>` renders every variant plus a lineup → open the lineup and each
   variant sheet; fix problems (0 errors on every variant).
4. `node studio diff <slug>` must show no change to the base asset unless the user asked for one.
5. `node studio save <slug> -m "<the request verbatim>"`.
6. Reply with the variant names and how each differs. They export as `<slug>--<variant>.glb`.
