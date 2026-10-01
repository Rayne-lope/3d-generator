---
description: Render and critically review an asset (contact sheet + parity + checklist)
argument-hint: <slug | set:name> [generic|godot|roblox]
allowed-tools: Bash(node studio:*), Read, Write, Edit, Glob, Grep
---

Review `$ARGUMENTS` (asset slug or `set:<name>`, optionally followed by a profile).

1. `node studio review <target> [--profile <profile>]`.
2. Open every printed sheet PNG (and the lineup for sets/variants) with Read and **look** at it.
3. Go through `rules/checklists/review.md` line by line against the stored prompt
   (`meta.prompt`): fidelity, form, surface, construction, export. Check the report: 0 errors,
   warnings understood, parity OK (open the `parity/` images if not).
4. Fix the problems you find in the asset code (never in `studio/`), then review again.
5. If you changed anything, `node studio save <target> -m "review fixes: <short summary>"`.
6. Reply with a short verdict: what is good, what you fixed, what remains (with suggestions).
