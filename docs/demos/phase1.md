# Phase 1 demo — end-to-end studio foundation

**Goal (PRD):** prove the whole loop from the start: prompt → asset → preview → GLB.
**Done when** a user can ask for a simple asset, see it in the browser, and open the same .glb
in Godot and Roblox Studio with matching shape, scale and colors.

## The loop

```bash
node studio dev            # live viewport at http://127.0.0.1:5178 (keep it open)
claude                     # in another terminal: "/asset A stylized wooden barrel with chunky iron hoops"
```

1. The agent runs `node studio new stylized-barrel --prompt "…"` and writes procedural Three.js
   code in `assets/stylized-barrel/asset.js`, using the studio kit (`studio/kit`).
2. Every save triggers a rebuild in a child process. The rebuild runs asset → three.js scene →
   IR → GLB → validation, writes `.studio/preview/stylized-barrel/generic.glb`, and the viewport
   reloads **that file** through a plain `GLTFLoader` (live reload over SSE, camera kept).
3. The agent reviews its own work from the same file: `node studio review stylized-barrel`
   renders a contact sheet from the GLB, which it opens with its image reader.

![Live viewport](img/phase1-viewport.png)

The viewport shows only exported files. It has neutral lighting (the parity reference), the size
in m (and studs for Roblox), a 1 m grid, a 1.75 m human for scale, wireframe, backface highlight,
UV checker and texel-density views, the report and issues, the UV layout at export resolution,
variants and versions. It never builds geometry itself.

## Preview = Export

- The preview GLB is byte-for-byte what `export` writes. Phase 5 enforces this: `export`
  rebuilds from scratch and refuses to write the file if the bytes differ.
- The parity check renders the original three.js scene (built in the browser from the same asset
  module) and the re-imported GLB from identical cameras, and compares them pixel by pixel. Every
  golden item measures 0.00 % difference in every profile.

## Import path decision

| Engine | Path | Status |
| --- | --- | --- |
| Godot 4 | GLB directly (editor import or runtime `GLTFDocument`) | **Verified in Godot 4.7.2**: 38/38 golden items load with the expected size, triangles, pivots, colors and materials; renders match (see [phase5.md](phase5.md)) |
| Roblox Studio | GLB directly (File > Import 3D). No FBX/OBJ conversion needed | Exports pre-scaled to studs and color-baked by the Roblox profile. The import itself is checked by hand with [engines/roblox/CHECKLIST.md](../../engines/roblox/CHECKLIST.md) |

The research behind these decisions is in [docs/DECISIONS.md](../DECISIONS.md).
