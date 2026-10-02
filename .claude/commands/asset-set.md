---
# Generated from .agents/skills/asset-set/SKILL.md by `node studio agents`. Edit that file, not this one.
description: "Create a set (pack) of matching studio assets from one prompt, sharing one style module (palette, materials, bevels, shared dimensions) in sets/<set>/style.js. Use when the user asks for several related assets at once, a kit, a pack or props for one theme."
argument-hint: "<prompt describing the pack>"
allowed-tools: Bash(node studio:*), Read, Write, Edit, Glob, Grep
---

Request: $ARGUMENTS

# Create a set from one prompt

Input: the user's prompt for the pack.

Follow **Workflow D** (`AGENTS.md`) and `rules/09-sets-and-variants.md`:

1. Reply with your interpretation: the set name, the member list (3–8 assets) and the shared style
   (palette, materials, proportions, bevel size, detail level).
2. `node studio new-set <set> --members a,b,c --prompt "<the prompt verbatim>" --style <words>`.
3. Design `sets/<set>/style.js` first: palette, material factories, shared dimensions (e.g. table
   height ↔ stool height), bevel sizes and shared helper functions. Members import it; do not
   duplicate style values inside members.
4. Build each member (`rules/01`–`06` + the relevant type rules), reviewing as you go:
   `node studio review <member>`.
5. `node studio review set:<set>` → open the lineup image with your image tool: same palette,
   same bevels, believable relative scale next to the 1.75 m figure. Fix outliers.
6. `node studio save set:<set> -m "<the prompt verbatim>"`.
7. Reply with the members (size, triangles each) and how they share the style.
