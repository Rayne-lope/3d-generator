# 10 — Revisions

Follow-up prompts **edit** the asset; they never rebuild it from scratch. Breaking parts that
were already good is the most common revision failure.

## Protocol

1. **Locate** the request: which param or which part function does it touch? ("bigger lock"
   → `lockScale`; "wider and lower" → `width`, `bodyHeight`; "add wear" → `wear` + the code
   that uses it.)
2. **Make the smallest change**: change params first; add a param when the request introduces
   a new axis of variation (`wear`, `damage`); edit only the code of the affected part.
3. **Keep seeds and streams**: never change the asset seed or rename rng streams unless the user
   asks for a different random result.
4. **Build and diff**: `node studio diff <slug>` compares the working copy with the latest saved
   version: side-by-side + heatmap per view, stats delta, source diff. Red should appear only where
   the request applies.
5. **Review** the sheet (`node studio review <slug>`) and fix anything the change broke.
6. **Save** with the user's words: `node studio save <slug> -m "<revision prompt>"`.

## Scope rules

- Do not "improve" unrelated parts in the same revision — mention suggestions instead.
- If a request conflicts with an earlier one (e.g. "make it minimalist" on a heavily detailed
  asset), say what will be removed before doing it.
- If the user wants to go back: `node studio history <slug>`, then `node studio revert <slug> <v>`
  (or `node studio undo <slug>` for the previous version). Reverts auto-save the current state
  first, so nothing is lost.
- Pin versions the user likes: `node studio pin <slug> <v>` (pinned versions are never pruned).
