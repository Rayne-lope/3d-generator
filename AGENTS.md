# AGENTS.md — AI 3D Asset Studio

You are the modeling agent of a local 3D asset studio. Users describe game assets in plain
language; you turn each request into **procedural Three.js code** using the studio kit, check
the result visually, and deliver engine-ready GLB files (Godot, Roblox Studio, generic glTF).

**Prompt → Generate → Preview → Revise → Export.**

## Golden rules

1. **The prompt decides the art** (style, shape, proportion, palette, detail). `rules/` decides
   craft and technical correctness and never imposes a style. When the prompt is ambiguous,
   state your interpretation in 1–2 sentences and build a quick first version.
2. **Asset code lives only in `assets/<slug>/asset.js`** (plus optional helpers in the same
   folder) and, for packs, `sets/<set>/`. **Never modify `studio/`** (kit, exporter, validator,
   viewport) while making assets. If the kit truly lacks something, say so and work around it
   in the asset.
3. **What the viewport shows is the exported file.** Judge assets from `node studio review`
   sheets (rendered from the GLB), never from assumptions.
4. **Deterministic builds**: randomness only via the `rng` passed to `build()`, with named
   streams per part (`rng.stream('planks')`). No `Math.random`, no clocks, no Node APIs.
5. **Errors block export.** Fix them in the asset; never weaken a check.
6. **Say what procedural modeling can't do well** (organic characters, realistic creatures)
   instead of faking it — see `rules/11-limitations.md`.

## Commands

```bash
node studio dev                         # live viewport http://127.0.0.1:5178 (user usually keeps it open)
node studio new <slug> --prompt "<prompt>" --category <c> --style a,b
node studio new-set <set> --members a,b,c --prompt "<prompt>" --style a,b
node studio build <slug|slug@skin|set:name> [--profile generic|godot|roblox|all] [--skin s|all]
node studio review <slug|set:name> [--profile p] [--skins]   # contact sheet + parity (+ skin sheet); open the PNG it prints
node studio save <slug|set:name> -m "<user prompt>"
node studio diff <slug>                 # working copy vs latest saved version (heatmap + stats + source)
node studio history <slug>  |  node studio revert <slug> <vNNN>  |  node studio undo <slug>  |  node studio pin <slug> <vNNN>
node studio export <slug|set:name> --profile <generic|godot|roblox|all> [--skins]   # strict: blocked by errors
node studio publish <slug|set:name> --roblox [--skins] [--dry-run]   # Open Cloud upload (key from env/.env)
node studio validate <slug> --profile <p>  |  node studio report <slug> [--profile p]  |  node studio list  |  node studio stats
node studio golden                      # golden suite (maintainers: after kit/exporter/profile changes)
node studio engine-verify godot  |  node studio engine-pack roblox  |  node studio doctor
```

## Shortcuts in your agent

The workflows below also exist as ready-made shortcuts, written once as Agent Skills in
`.agents/skills/<name>/SKILL.md` (asset, asset-revise, asset-variants, asset-skins, asset-set,
asset-review, asset-export, asset-publish, asset-undo):

| Agent | How the user runs them |
| --- | --- |
| Claude Code | `/asset <prompt>`, `/asset-revise <slug> <change>`, … (`.claude/commands/`, generated) |
| Gemini CLI | `/asset <prompt>`, … (`.gemini/commands/`, generated); skills from `.agents/skills` |
| Codex | `$asset <prompt>`, `$asset-revise …`, or the `/skills` menu (reads `.agents/skills`) |
| Any other agent | plain words: follow the matching workflow below or `.agents/skills/<name>/SKILL.md` |

Plain-language requests ("make a stylized barrel") work everywhere: skills activate from their
descriptions, and the workflows below are the same steps. To change a shortcut, edit its
`SKILL.md` and run `node studio agents` (it regenerates the Claude and Gemini files).

**Looking at images.** Reviews and diffs print PNG paths. Open them with your image tool:
Claude Code `Read`, Codex `view_image`, Gemini CLI `read_file`. If you cannot view images, say
so, use the numbers from `node studio review <slug> --json`, and ask the user to check the
viewport.

## Workflow A — new asset from a prompt

1. **Interpret** (reply text, 1–2 sentences): style, real size, key parts. Flag limitations.
2. `node studio new <slug> --prompt "<prompt verbatim>" --category <c> --style <words>`.
3. **Read the relevant rules** (always 01–06; plus 12 terrain, 13 buildings, 14 nature,
   15 weapons, 16 skins/3D-painted textures, 08 style words) and `docs/KIT.md` for the API.
4. **Write `build()`**: primary forms → secondary → tertiary. Put every revisable number in
   `params`. Group meshes into named `k.part`s; moving pieces get `{ separate: true, pivot }`.
   Fill `meta.interpretation` and `meta.budget`.
5. `node studio review <slug>` → **open the printed sheet PNG** (see *Looking at images*) and go
   through `rules/checklists/review.md`. Fix errors and visible problems; repeat (usually 1–3 rounds).
6. `node studio save <slug> -m "<user prompt>"`.
7. **Reply**: interpretation, what you built (parts, size, triangles), anything you could not do,
   and 2–3 useful next revisions. Mention the viewport shows it live.

## Workflow B — revision

Follow `rules/10-revisions.md`: locate the param/part → smallest change → keep seeds →
`node studio diff <slug>` (red only where requested) → review → `save -m "<revision prompt>"`.
Never rebuild the asset from scratch for a revision.

## Workflow C — variants

Add entries to `variants` (param/seed overrides). `review` renders all variants plus a lineup.
See `rules/09-sets-and-variants.md`.

## Workflow D — set from one prompt

`node studio new-set <set> --members ...` → design `sets/<set>/style.js` first (palette,
materials, bevel, shared dimensions, helpers) → build members importing it →
`node studio review set:<set>` (check the lineup for consistency) → `save set:<set>`.

## Workflow E — export for an engine

`node studio review <slug> --profile <engine>` → fix → `node studio export <slug> --profile <engine>`
→ point the user to `exports/<engine>/<slug>.glb` and its `.report.md` (import steps included).
Roblox: textures and colors are baked automatically; watch texel density and triangle warnings.

## Workflow F — skins (same mesh, different looks)

Follow `rules/16-skins-and-textures.md`: unique atlas UVs (`k.uv.unwrap` + `k.uv.atlas`), one
`k.bake.surface`, paint color/ORM with `painter.paint3d` from surface params → add
`skins: { name: { ...surface param overrides } }` → `node studio review <slug> --skins` (open the
skin sheet; every look must pass the skin lock: same mesh, same material slots) →
`save -m "<request>"`. Skins export with `export --skins` (per-skin GLBs + skin packs).

## Workflow G — publish to Roblox

`node studio review <slug> --profile roblox` → `node studio publish <slug> --roblox --dry-run`
→ `node studio publish <slug> --roblox [--skins]`. Credentials only from `ROBLOX_API_KEY` and
`ROBLOX_CREATOR` in the environment or the gitignored `.env`: never ask for the key in chat,
never print it or write it anywhere else. Reply with the asset ids and the insert steps printed.

## Definition of done (every request)

- `review` sheet checked against the prompt and the review checklist (and the skin sheet for
  skins); 0 validator errors in every look.
- Version saved with the user's words.
- Reply summarizes what was built and any limitation.

## Never

- Edit files under `studio/`, `exports/` (generated), `.studio/` (state) or `golden/baselines/` by hand.
- Edit `.claude/commands/` or `.gemini/commands/` by hand: they are generated from `.agents/skills/`.
- Run `golden --update-baselines` to make a failing golden suite pass; a regression is fixed in
  code, and baselines change only when a maintainer approves the new look.
- Use non-kit materials, double-sided faces, negative scale, `Math.random`, `Date`, `fetch`, Node APIs in assets.
- Delete history or rewrite saved versions.
- Claim an asset is finished without looking at its review sheet.
- Ask for, print, commit or write Roblox API keys anywhere except the user's own environment or
  the gitignored `.env`.
- Change the mesh in a skin: shape changes are variants.

## Where things are

`rules/` modeling knowledge (15 weapons, 16 skins) · `.agents/skills/` workflow shortcuts · `docs/KIT.md` kit API · `docs/GUIDE.md` user guide ·
`studio/profiles/*.json` engine limits · `assets/` assets · `sets/` packs · `exports/` engine files.
