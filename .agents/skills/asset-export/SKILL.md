---
name: asset-export
description: Export a studio asset or set for a game engine (Godot, Roblox Studio or generic glTF) with the strict export that is blocked by validation errors, and report the files and import steps. Use when the user asks to export, deliver or prepare an asset for Godot, Roblox or another engine.
metadata:
  argument-hint: "<slug | set:name> <generic|godot|roblox|all>"
---

# Export for an engine

Input: an asset slug or `set:<name>`, then the profile (generic, godot, roblox or all).

Follow **Workflow E** (`AGENTS.md`) and `rules/07-export-hygiene.md`:

1. `node studio review <target> --profile <profile>` → open the sheet with your image tool. The
   engine profile can change the asset (Roblox: studs scale, baked colors, palette atlas, one
   material per mesh, 1024 px textures, 20k triangles per mesh). Make sure it still looks right.
2. Fix every error in the asset code (the fix guide per issue id is in `rules/07`). Never weaken
   a check. Re-run the review.
3. `node studio export <target> --profile <profile>`. It is blocked while errors remain.
4. Reply with the exported file paths (`exports/<profile>/<slug>.glb`), the key numbers from the
   `.report.md` (size, triangles, meshes, textures) and the engine import steps from the report.
