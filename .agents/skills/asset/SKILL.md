---
name: asset
description: Create a new 3D game asset from a text prompt in the AI 3D Asset Studio (procedural Three.js code in assets/<slug>/asset.js, checked from rendered review sheets, exported as GLB for Godot, Roblox Studio and glTF). Use when the user asks to make, model or generate a new prop, building, terrain piece, plant or other object.
metadata:
  argument-hint: "<prompt describing the asset>"
---

# Create a new asset

Input: the user's prompt (the text after the command, or their message).

Follow **Workflow A** in `AGENTS.md`:

1. Reply with your interpretation in 1–2 sentences (style, real-world size, key parts). If part
   of the request is beyond procedural modeling (`rules/11-limitations.md`), say so now.
2. Pick a short kebab-case slug and run
   `node studio new <slug> --prompt "<the prompt verbatim>" --category <category> --style <style,words>`.
3. Read `rules/01`–`06`, the rule files for the asset type (12 terrain, 13 buildings, 14 nature,
   08 for the style words) and `docs/KIT.md`.
4. Write `build()` in `assets/<slug>/asset.js`: primary forms → secondary → tertiary detail.
   Revisable numbers go in `params`. Moving parts get `{ separate: true, pivot }`. Fill
   `meta.interpretation` and `meta.budget`. Never edit `studio/`.
5. `node studio review <slug>` → open the printed sheet PNG with your image tool and look at it
   (Claude Code: Read · Codex: view_image · Gemini CLI: read_file) → go through
   `rules/checklists/review.md` → fix → review again (usually 1–3 rounds). 0 errors required.
6. `node studio save <slug> -m "<the prompt verbatim>"`.
7. Reply: what you built (parts, size in m, triangles), anything you could not do, and 2–3 useful
   next revisions. Mention that the viewport (`node studio dev`) shows it live.
