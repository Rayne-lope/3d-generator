---
description: Revise an existing asset (smallest change, verified with a visual diff)
argument-hint: <slug> <what to change>
allowed-tools: Bash(node studio:*), Read, Write, Edit, Glob, Grep
---

Revise an existing asset. Arguments: `$ARGUMENTS` (first word = asset slug or `set:<name>`,
the rest = the user's revision request).

Follow **Workflow B** (`AGENTS.md`) and `rules/10-revisions.md`:

1. `node studio history <slug>`. If the working copy has unsaved changes, ask before mixing them in.
2. Locate the param or part the request touches in `assets/<slug>/asset.js`. Make the smallest
   change: params first; add a new param for a new axis of variation (e.g. `wear`, `damage`);
   edit only the affected part's code. Never change the seed or rename rng streams, and never
   rebuild the asset from scratch.
3. `node studio diff <slug>` → open the diff sheet. Red (changed pixels) must appear only where the
   request applies. If other areas changed, find out why and fix it.
4. `node studio review <slug>` → open the sheet → fix anything the change broke (0 errors).
5. `node studio save <slug> -m "<the revision request verbatim>"`.
6. Reply: what changed (params/parts, stats delta from the diff), and offer `/undo` if the user
   does not like it.
