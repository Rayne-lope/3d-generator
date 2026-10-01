// Medieval Street Lamp
// Prompt: "Medieval wrought-iron street lamp post with a hanging lantern"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Medieval Street Lamp',
    prompt: 'Medieval wrought-iron street lamp post with a hanging lantern',
    interpretation: '3.2 m post: chamfered stone plinth, octagonal wrought-iron shaft with collars, a scrolled bracket arm, and a four-sided lantern with a pyramid hood and warm lit glass hanging from a ring. Iron is metallic but rough; the glass glows (opaque, emissive) for predictable results in every engine.',
    style: ['medieval', 'realistic'],
    category: 'lighting',
    budget: { triangles: 5000 },
  },
  seed: 1350,
  params: {
    height: 3.2,
    armLength: 0.75,
    lanternSize: 0.34,
    iron: '#33353a',
    stone: '#8b8679',
    glass: '#ffcf7a',
    glow: 0.9,
  },
  variants: {
    unlit: { glow: 0, glass: '#3d4a52' },
  },
  build({ p, k }) {
    const asset = k.asset('street_lamp');
    const iron = k.mat.pbr({ name: 'wrought_iron', color: p.iron, roughness: 0.62, metalness: 1 });
    const stone = k.mat.physical('stone', { name: 'plinth_stone', color: p.stone });
    const glass = k.mat.pbr({ name: 'lantern_glass', color: p.glow > 0 ? '#5a4a2a' : p.glass, roughness: 0.2, emissive: p.glow > 0 ? p.glass : null, emissiveIntensity: p.glow || 1 });
    const H = p.height;

    const post = k.part('post');
    post.add(k.mesh(k.geo.box(0.42, 0.32, 0.42, { bevel: 0.03, base: true }), stone));
    post.add(k.mesh(k.geo.box(0.34, 0.08, 0.34, { bevel: 0.02, base: true }), stone, { at: [0, 0.32, 0] }));
    // Shaft: octagonal, slightly tapered, with collars and a finial.
    post.add(k.mesh(k.geo.prism(8, 0.055, H - 0.62, { radiusTop: 0.04, base: true }), iron, { at: [0, 0.4, 0] }));
    for (const [y, r, h] of [[0.4, 0.085, 0.07], [1.2, 0.07, 0.04], [H - 0.28, 0.065, 0.05]]) {
      post.add(k.mesh(k.geo.cylinder(r, h, { segments: 12, bevel: 0.01, base: true }), iron, { at: [0, y, 0] }));
    }
    post.add(k.mesh(k.geo.lathe([[0, 0], [0.045, 0], [0.05, 0.03], [0.022, 0.06], [0.035, 0.1], [0, 0.18]], { segments: 10 }), iron, { at: [0, H - 0.22, 0] }));

    // Bracket arm with a decorative scroll underneath.
    const arm = k.part('arm');
    const ay = H - 0.36;
    arm.add(k.mesh(k.geo.box(p.armLength, 0.035, 0.035, { bevel: 0.006 }), iron, { at: [p.armLength / 2, ay, 0] }));
    const scroll = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const a = t * Math.PI * 1.6;
      const r = 0.22 * (1 - t * 0.55);
      scroll.push([0.05 + t * p.armLength * 0.55 + Math.sin(a) * r * 0.25, ay - 0.04 - Math.sin(t * Math.PI) * 0.28 + (1 - Math.cos(a)) * r * 0.15, 0]);
    }
    arm.add(k.mesh(k.geo.tube(scroll, 0.012, { segments: 40, radialSegments: 6 }), iron));
    arm.add(k.mesh(k.geo.tube([[0.04, ay - 0.02, 0], [0.12, ay - 0.3, 0], [0.04, ay - 0.42, 0]], 0.012, { segments: 16, radialSegments: 6 }), iron));

    // Hanging ring + lantern.
    const lantern = k.part('lantern');
    const lx = p.armLength - 0.08;
    const s = p.lanternSize;
    lantern.add(k.mesh(k.geo.torus(0.035, 0.008, { axis: 'z', tubularSegments: 16, radialSegments: 6 }), iron, { at: [lx, ay - 0.05, 0] }));
    lantern.add(k.mesh(k.geo.cylinder(0.006, 0.08, { segments: 6 }), iron, { at: [lx, ay - 0.12, 0] }));
    const top = ay - 0.16;
    // Hood: four-sided pyramid with a small cap.
    lantern.add(k.mesh(k.geo.cone(s * 0.82, s * 0.45, { segments: 4, base: true, flat: true }), iron, { at: [lx, top - s * 0.45, 0], rot: [0, Math.PI / 4, 0] }));
    lantern.add(k.mesh(k.geo.box(s * 0.95, 0.03, s * 0.95, { bevel: 0.006 }), iron, { at: [lx, top - s * 0.45 - 0.015, 0] }));
    // Glass body and corner posts.
    const gy = top - s * 0.45 - 0.03 - s * 0.55;
    lantern.add(k.mesh(k.geo.box(s * 0.78, s * 1.1, s * 0.78), glass, { at: [lx, gy, 0] }));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        lantern.add(k.mesh(k.geo.box(0.022, s * 1.12, 0.022, { bevel: 0.004 }), iron, { at: [lx + sx * s * 0.39, gy, sz * s * 0.39] }));
      }
    }
    // Mid bars on each face.
    for (const [dx, dz, w, d] of [[0, s * 0.395, s * 0.8, 0.012], [0, -s * 0.395, s * 0.8, 0.012], [s * 0.395, 0, 0.012, s * 0.8], [-s * 0.395, 0, 0.012, s * 0.8]]) {
      lantern.add(k.mesh(k.geo.box(w, 0.014, d), iron, { at: [lx + dx, gy, dz] }));
    }
    // Base pan.
    lantern.add(k.mesh(k.geo.cylinder(s * 0.5, 0.04, { radiusTop: s * 0.56, segments: 4, flat: true, base: true }), iron, { at: [lx, gy - s * 0.55 - 0.04, 0], rot: [0, Math.PI / 4, 0] }));
    lantern.add(k.mesh(k.geo.cone(0.03, 0.06, { segments: 8, base: true }), iron, { at: [lx, gy - s * 0.55 - 0.1, 0], rot: [Math.PI, 0, 0] }));
    asset.add(post, arm, lantern);
    return asset;
  },
});
