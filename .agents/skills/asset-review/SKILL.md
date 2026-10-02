---
name: asset-review
description: Render and critically review a studio asset or set (multi-view contact sheet of the exported GLB, source-vs-GLB parity, validator report, review checklist) and fix what is wrong. Use when the user asks to check, review, inspect or improve the quality of an asset.
metadata:
  argument-hint: "<slug | set:name> [generic|godot|roblox]"
---

# Review an asset

Input: an asset slug or `set:<name>`, optionally followed by a profile.

1. `node studio review <target> [--profile <profile>]`.
2. Open every printed sheet PNG (and the lineup for sets and variants) with your image tool
   (Claude Code: Read · Codex: view_image · Gemini CLI: read_file) and **look** at it. If you
   cannot view images, use `node studio review <target> --json` and ask the user to check the
   viewport.
3. Go through `rules/checklists/review.md` line by line against the stored prompt
   (`meta.prompt`): fidelity, form, surface, construction, export. Check the report: 0 errors,
   warnings understood, parity OK (open the `parity/` images if not).
4. Fix the problems you find in the asset code (never in `studio/`), then review again.
5. If you changed anything, `node studio save <target> -m "review fixes: <short summary>"`.
6. Reply with a short verdict: what is good, what you fixed, what remains (with suggestions).
