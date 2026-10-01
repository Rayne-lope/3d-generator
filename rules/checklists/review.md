# Review checklist

Run after every `node studio review <slug>` — open the sheet image and check each line. Fix,
re-review, then save.

## Prompt fidelity

- [ ] Every element the prompt names is present and recognizable (count them).
- [ ] The style words are visible (low-poly facets, cartoon exaggeration, realistic wear…).
- [ ] Colors and materials match the prompt; nothing contradicts it.
- [ ] `meta.interpretation` describes what was actually built.

## Form

- [ ] Front, side and top silhouettes are readable and distinct (01).
- [ ] Proportions are believable for the style; human-scale parts fit the 1.75 m figure (02).
- [ ] Primary → secondary → tertiary detail; rest areas exist (03).
- [ ] Hard edges are beveled (unless the style is crisp low-poly).

## Surface

- [ ] Value contrast separates the main parts.
- [ ] Metals are 0/1; no polished-metal warning unless intended (04).
- [ ] Textures run in the right direction (grain along boards, straw down the slope).
- [ ] Texel density consistent, no blurry or stretched areas (UV checker / density view).

## Construction

- [ ] Nothing floats; nothing intersects visibly where it shouldn't; no z-fighting.
- [ ] No missing faces (backfaces view shows no red from outside).
- [ ] Moving parts are separate with the pivot on the hinge/axle (06).
- [ ] Triangle count within `meta.budget`; no wasted segments on tiny parts (05).

## Export

- [ ] 0 errors in the report; warnings understood.
- [ ] Parity OK (source vs GLB).
- [ ] For a target engine, built and reviewed with `--profile <engine>` (07).
