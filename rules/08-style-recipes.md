# 08 — Style recipes

Techniques that realize common style words. They are tools, not defaults: the prompt decides
which style, these notes help you deliver it.

| Style | Shapes | Shading & materials | Detail |
| --- | --- | --- | --- |
| **Low-poly** | Few segments (5–8 around), jittered vertices, faceted cones/icospheres | `flat` shading, 2–5 flat colors, no textures | Big readable chunks; no micro detail |
| **Stylized** | Exaggerated proportions (thicker, rounder, bulging), generous bevels | `crease` shading, flat colors or soft painted textures, painted metal (metalness 0) | Chunky hoops, big rivets, grooves; slight asymmetry |
| **Cartoon** | Squash & stretch, oversized focal parts, wonky leans, soft rounded edges | Saturated colors, high value contrast, smooth shading | Minimal, bold features (big knob, big flag) |
| **Realistic** | Real dimensions (02), crisp but small bevels, real thickness | Baked textures: color + normal + roughness, metalness 0/1, subtle wear | Construction detail (brackets, bolts, seams), wear where touched |
| **Sci-fi** | Chamfered boxes, panel insets, repeated modules, symmetric layouts | Off-white/gray + one accent, emissive strips | Panel lines, vents, handles, small displays, decals as geometry |
| **Fantasy** | Organic-meets-crafted shapes, points and curls, glowing elements | Rich saturated hues, emissive accents | Crystals, runes (geometry), scrolls, ornaments |
| **Medieval** | Heavy timber, stone, wrought iron scrolls | Rough materials, dark metals, warm light | Rivets, straps, chamfered stone, irregular stones |
| **Post-apocalyptic** | Familiar objects, damaged: dents, missing pieces, bends | Faded paint, rust (`rust`), grime (`dirt`), scratches revealing metal | Hazard stripes, makeshift repairs, uneven wear |
| **Steampunk** | Pipes, flanges, gauges, gears, rivets | Brass/copper metals (metalness 1, roughness 0.35–0.45), dark iron, cream dials | Bolted flanges, handwheels, painted dials |
| **Minimalist** | Few clean primitives, thin profiles, precise proportions | 1–2 materials, light woods, white/black, subtle grain | Almost none; perfect alignment matters |
| **Cozy** | Soft, rounded, slightly oversized, warm | Warm wood, cream, warm emissive light | Handmade imperfection, candles, fabric |
| **Voxel / blocky** | Cubes on a grid (`k.units.snap`), no bevels | Flat colors, `flat` shading | Pixel-like color variation per block |

## Combining styles

"Stylized post-apocalyptic" = stylized shapes (chunky, beveled) + post-apocalyptic surface
storytelling (rust, dents) in flat or soft painted colors. Decide the **shape language** from
one word and the **surface treatment** from the other, then say so in `meta.interpretation`.
