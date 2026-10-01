// Sci-fi Supply Crate
// Prompt: "Sci-fi supply crate with glowing cyan panels, panel lines and handles"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Sci-fi Supply Crate',
    prompt: 'Sci-fi supply crate with glowing cyan panels, panel lines and handles',
    interpretation: '1.0 × 0.55 × 0.6 m hard-surface case: chamfered off-white shell with a lid seam, recessed side panels, dark armored corner guards, two grab handles, cyan light strips and a small status display. Flat colors; glow comes from emissive strips.',
    style: ['sci-fi', 'hard-surface'],
    category: 'container',
    budget: { triangles: 5000 },
  },
  seed: 2077,
  params: {
    width: 1.0,
    height: 0.55,
    depth: 0.6,
    bevel: 0.03,
    shell: '#d9dde2',
    armor: '#2b2f36',
    trim: '#7d8590',
    glow: '#39e6ff',
    glowStrength: 1.0,
    lidSplit: 0.72, // lid seam height as a fraction of height
  },
  variants: {
    military: { shell: '#5d6b4c', trim: '#3c4434', glow: '#ffb03a' },
  },
  build({ p, k }) {
    const asset = k.asset('scifi_crate');
    const shell = k.mat.pbr({ name: 'shell', color: p.shell, roughness: 0.42 });
    const armor = k.mat.pbr({ name: 'armor', color: p.armor, roughness: 0.55 });
    const trim = k.mat.pbr({ name: 'trim', color: p.trim, roughness: 0.4 });
    const glow = k.mat.pbr({ name: 'glow', color: '#0e2a30', emissive: p.glow, emissiveIntensity: p.glowStrength, roughness: 0.3 });
    const W = p.width;
    const H = p.height;
    const D = p.depth;

    const body = k.part('body');
    // Main shell, split at the lid seam by a thin recessed band.
    const seamY = H * p.lidSplit;
    body.add(k.mesh(k.geo.box(W, seamY - 0.006, D, { bevel: p.bevel, base: true }), shell));
    body.add(k.mesh(k.geo.box(W, H - seamY - 0.006, D, { bevel: p.bevel }), shell, { at: [0, seamY + 0.006 + (H - seamY - 0.006) / 2, 0] }));
    body.add(k.mesh(k.geo.box(W - 0.03, 0.02, D - 0.03), armor, { at: [0, seamY, 0], name: 'seam' }));
    // Lid top plate (raised) with grip slots.
    body.add(k.mesh(k.geo.box(W * 0.72, 0.02, D * 0.62, { bevel: 0.008 }), trim, { at: [0, H + 0.008, 0], name: 'lid_plate' }));
    for (const x of [-0.18, 0, 0.18]) body.add(k.mesh(k.geo.box(0.12, 0.008, 0.025, { bevel: 0.003 }), armor, { at: [x * W, H + 0.019, 0] }));

    // Recessed panels on the long faces with a cyan strip and panel lines.
    const panels = k.part('panels');
    for (const sz of [-1, 1]) {
      const z = sz * (D / 2 + 0.004);
      panels.add(k.mesh(k.geo.box(W * 0.6, seamY * 0.62, 0.012, { bevel: 0.004 }), trim, { at: [0, seamY * 0.48, z] }));
      panels.add(k.mesh(k.geo.box(W * 0.5, 0.022, 0.016, { bevel: 0.003 }), glow, { at: [0, seamY * 0.78, z + sz * 0.003], name: 'strip' }));
      for (const x of [-0.24, 0.24]) panels.add(k.mesh(k.geo.box(0.006, seamY * 0.5, 0.016), armor, { at: [x * W, seamY * 0.42, z + sz * 0.002], name: 'panel_line' }));
    }
    // Status display on the front.
    panels.add(k.mesh(k.geo.box(0.12, 0.05, 0.012, { bevel: 0.003 }), armor, { at: [W * 0.36, seamY * 0.5, D / 2 + 0.008] }));
    panels.add(k.mesh(k.geo.box(0.09, 0.028, 0.006), glow, { at: [W * 0.36, seamY * 0.5, D / 2 + 0.014], name: 'display' }));

    // Corner guards: chunky dark armor wrapping each vertical edge.
    const guards = k.part('guards');
    const gs = 0.075;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (W / 2 - gs / 2 + 0.012);
        const z = sz * (D / 2 - gs / 2 + 0.012);
        guards.add(k.mesh(k.geo.box(gs, H * 0.34, gs, { bevel: 0.012 }), armor, { at: [x, H * 0.17, z] }));
        guards.add(k.mesh(k.geo.box(gs, H * 0.24, gs, { bevel: 0.012 }), armor, { at: [x, H - H * 0.12 + 0.004, z] }));
      }
    }
    // Feet.
    for (const sx of [-1, 1]) guards.add(k.mesh(k.geo.box(0.06, 0.02, D * 0.8, { bevel: 0.006 }), armor, { at: [sx * W * 0.32, 0.01, 0] }));

    // Grab handles on the short faces.
    const handles = k.part('handles');
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 + 0.01);
      const pts = [[x, seamY * 0.62, -0.12], [x + sx * 0.05, seamY * 0.66, -0.1], [x + sx * 0.06, seamY * 0.7, 0], [x + sx * 0.05, seamY * 0.66, 0.1], [x, seamY * 0.62, 0.12]];
      handles.add(k.mesh(k.geo.tube(pts, 0.012, { segments: 16, radialSegments: 8 }), trim));
      for (const z of [-0.12, 0.12]) handles.add(k.mesh(k.geo.box(0.02, 0.05, 0.04, { bevel: 0.005 }), armor, { at: [x - sx * 0.002, seamY * 0.62, z] }));
    }
    // Vent slots above each handle and bolts on the lid plate corners.
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        handles.add(k.mesh(k.geo.box(0.012, 0.012, 0.09, { bevel: 0.003 }), armor, { at: [sx * (W / 2 + 0.002), seamY * 0.86 - i * 0.022, 0], name: 'vent' }));
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.add(k.mesh(k.geo.cylinder(0.009, 0.006, { segments: 8, bevel: 0.002, base: true }), armor, { at: [sx * W * 0.33, H + 0.018, sz * D * 0.27], name: 'bolt' }));
    asset.add(body, panels, guards, handles);
    return asset;
  },
});
