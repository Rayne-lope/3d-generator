@AGENTS.md

## Claude Code notes

- After `node studio review`, open the printed `sheet.png` with the Read tool and actually look
  at it before deciding the asset is done. With `--skins`, also open the printed `skins.png`. Use the per-view PNGs in the same folder for close-ups
  and the `parity/` images (source | GLB | diff) when a parity warning appears. Open `parts.png`
  and `blueprint.png` when structure or proportions look off, `markers.png` when the asset has
  attachments or collision shapes, and `reference.png` when the asset has `meta.reference`.
- After `node studio scene review <name>`, open the printed scene `sheet.png` the same way
  (labeled plan, two dollhouse views, two eye-level views) before saving the scene.
- Slash commands wrap the workflows: `/asset <prompt>`, `/asset-revise <slug> <change>`,
  `/asset-variants <slug> <what>`, `/asset-skins <slug> <which skins>`, `/asset-set <prompt>`,
  `/asset-review <slug>`, `/asset-export <slug> <profile>`, `/asset-publish <slug> [skins]`,
  `/asset-undo <slug>`, `/scene <prompt>`. They are generated into
  `.claude/commands/` from `.agents/skills/` (shared with Codex and Gemini CLI): edit the skill,
  then run `node studio agents`.
- Do the work inline; long-running background tasks are not needed (builds take seconds).
- The user may watch `node studio dev` in a browser while you work; CLI builds refresh it.
