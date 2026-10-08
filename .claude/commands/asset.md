---
# Generated from .agents/skills/asset/SKILL.md by `node studio agents`. Edit that file, not this one.
description: "Create a new 3D game asset from a text prompt in the AI 3D Asset Studio (procedural Three.js code in assets/<slug>/asset.js, checked from rendered review sheets, exported as GLB for Godot, Roblox Studio and glTF). Use when the user asks to make, model or generate a new prop, building, terrain piece, plant or other object."
argument-hint: "<prompt describing the asset>"
allowed-tools: Bash(node studio:*), Read, Write, Edit, Glob, Grep
---

Request: $ARGUMENTS

# Create a new asset

Input: the user's prompt (the text after the command, or their message).

Follow **Workflow A** in `AGENTS.md`:

1. Reply with your interpretation in 1–2 sentences (style, real-world size, key parts). If part
   of the request is beyond procedural modeling (`rules/11-limitations.md`), say so now.
2. Pick a short kebab-case slug and run
   `node studio new <slug> --prompt "<the prompt verbatim>" --category <category> --style <style,words>`.
3. Read `rules/01`–`06`, the rule files for the asset type (12 terrain, 13 buildings, 14 nature,
   15 weapons, 17 complex shapes such as sci-fi gear, vehicles and gadgets, 08 for the style
   words) and `docs/KIT.md`. Buildings bigger than a hut use `k.arch.building` (rule 13 §9); for a
   photo of a house, read it into a plan first (rule 13 §10). If the user gave a picture, save it as `assets/<slug>/reference.png`
   and set `meta.reference: { image: 'reference.png', view: 'front' }` (rule 17).
4. Write `build()` in `assets/<slug>/asset.js`: primary forms → secondary → tertiary detail.
   Revisable numbers go in `params`. Editor support is standard for new assets: maintain a
   curated `editor` schema for useful shape and surface controls, testing the actual bounds.
   Keep seed, texture size and implementation details source-owned. Give named parts stable
   IDs; moving/detachable parts get `{ separate: true, pivot, id }` and an `editor.parts` entry
   for Move/Rotate/uniform Scale. Keep IDs when labels change, and do not split decorative
   detail just to offer a gizmo. See `docs/KIT.md` for the contract. Fill `meta.interpretation`
   and `meta.budget`. Never edit `studio/` while creating an asset.
5. `node studio review <slug>` → open the printed sheet PNG with your image tool and look at it
   (Claude Code: Read · Codex: view_image · Gemini CLI: read_file) → go through
   `rules/checklists/review.md` → fix → review again (usually 1–3 rounds). 0 errors required.
   When a piece or a proportion looks wrong, open `parts.png` (each part colored, with a legend)
   and `blueprint.png` (rulers in meters). With a reference, open `reference.png` and fix the
   largest red (model only) or cyan (reference only) area first; the IoU is printed.
6. `node studio save <slug> -m "<the prompt verbatim>" --include-variants` to save accurate Base
   and variant previews alongside the editor-enabled asset source.
7. Reply: what you built (parts, size in m, triangles), anything you could not do, and 2–3 useful
   next revisions. Mention that the viewport (`node studio dev`) shows it live.
