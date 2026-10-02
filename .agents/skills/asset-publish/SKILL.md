---
name: asset-publish
description: Publish a studio asset to Roblox through Open Cloud (model upload or new version, optional skins as SurfaceAppearance images plus an insertable .rbxmx), so it shows up in the user's Toolbox without a manual import. Use when the user asks to publish, upload or send an asset to Roblox.
metadata:
  argument-hint: "<slug | set:name> [skins]"
---

# Publish to Roblox

Input: an asset slug or `set:<name>`, optionally followed by "skins".

Follow **Workflow G** (`AGENTS.md`).

1. `node studio review <target> --profile roblox` (add `--skins` for skins) → open the sheet with
   your image tool and fix every error first: publishing runs the strict export.
2. `node studio publish <target> --roblox --dry-run` (add `--skins`) shows what would be uploaded
   without calling Roblox. Credentials come from `ROBLOX_API_KEY` and `ROBLOX_CREATOR`
   (`user:<id>` or `group:<id>`) in the environment or the gitignored `.env`. Never ask the user
   to paste the key into the chat, never print it, never write it into a file other than `.env`.
   If they are missing, tell the user how to create the key (docs/GUIDE.md → "Publish to Roblox":
   Creator Dashboard → Open Cloud → API Keys, Assets API read + write) and stop.
3. `node studio publish <target> --roblox` (add `--skins`). Unchanged files are skipped; a changed
   model becomes a new version of the same asset.
4. Reply with the asset ids, the insert steps the command printed (Toolbox → My Models, or
   `InsertService:LoadAsset`) and, with skins, the `.skins.rbxmx` to insert plus the
   `SkinSwitcher.apply(model, "<skin>", skins)` call. Mention that new images go through Roblox
   moderation and render blank until approved.
