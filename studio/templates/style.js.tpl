// Shared style for the '{{SET}}' set: {{TITLE}}
// Prompt: {{PROMPT}}
// Every member imports this module so palette, materials, proportions and edge
// treatment stay consistent across the pack. Change a value here → all members follow.

export const palette = {
  primary: '#a8683a',
  secondary: '#6b4426',
  accent: '#c9a24a',
  metal: '#4a4f57',
};

/** Shared dimensions (meters). */
export const dims = {
  bevel: 0.012, // edge chamfer used on every hard edge
  plankThickness: 0.035,
};

/** Shared materials, created once per build. */
export function materials(k) {
  return {
    primary: k.mat.pbr({ name: '{{SET}}_primary', color: palette.primary, roughness: 0.75 }),
    secondary: k.mat.pbr({ name: '{{SET}}_secondary', color: palette.secondary, roughness: 0.8 }),
    accent: k.mat.pbr({ name: '{{SET}}_accent', color: palette.accent, roughness: 0.5 }),
    metal: k.mat.pbr({ name: '{{SET}}_metal', color: palette.metal, roughness: 0.5 }),
  };
}

export default { palette, dims, materials };
