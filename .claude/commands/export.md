---
description: Export an asset or set for an engine (Godot, Roblox or generic glTF)
argument-hint: <slug | set:name> <generic|godot|roblox|all>
allowed-tools: Bash(node studio:*), Read, Write, Edit, Glob, Grep
---

Export `$ARGUMENTS` (asset slug or `set:<name>`, then the profile).

Follow **Workflow E** (`AGENTS.md`) and `rules/07-export-hygiene.md`:

1. `node studio review <target> --profile <profile>` → open the sheet. The engine profile can
   change the asset (Roblox: studs scale, baked colors, palette atlas, one material per mesh,
   1024 px textures, 20k triangles per mesh). Make sure it still looks right.
2. Fix every error in the asset code (the fix guide per issue id is in `rules/07`). Never weaken
   a check. Re-run the review.
3. `node studio export <target> --profile <profile>`. It is blocked while errors remain.
4. Reply with the exported file paths (`exports/<profile>/<slug>.glb`), the key numbers from the
   `.report.md` (size, triangles, meshes, textures) and the engine import steps from the report.
