// A/B demo — built following rules/ (same prompt as ab-lantern-norules).
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'A/B Lantern (with rules)',
    prompt: 'A medieval wall lantern on an iron bracket',
    interpretation: 'Wall lantern sized to a real wall: 0.45 m tall four-sided lantern with a pyramid hood, finial and drip pan, warm glowing glass set back behind beveled corner posts, hanging from a scrolled wrought-iron bracket on a riveted wall plate. Origin at the back so it mounts flush; painted dark iron for engine-independent looks.',
    style: ['medieval'],
    category: 'lighting',
    budget: { triangles: 3000 },
    origin: 'back-center',
  },
  seed: 1,
  params: { lantern: 0.3, reach: 0.42, iron: '#3a3c40', glow: '#ffc46b' },
  build({ p, k }) {
    const asset = k.asset('lantern');
    const iron = k.mat.pbr({ name: 'iron', color: p.iron, roughness: 0.55 });
    const glass = k.mat.pbr({ name: 'glass', color: '#5a4524', roughness: 0.25, emissive: p.glow, emissiveIntensity: 0.9 });
    const s = p.lantern;

    // Wall plate with rivets (primary anchor, tertiary rivets).
    const mount = k.part('mount');
    mount.add(k.mesh(k.geo.box(0.12, 0.22, 0.02, { bevel: 0.005 }), iron, { at: [0, 0.55, 0.01] }));
    for (const [x, y] of [[-0.035, 0.63], [0.035, 0.63], [-0.035, 0.47], [0.035, 0.47]]) {
      mount.add(k.mesh(k.geo.icosphere(0.009, 0), iron, { at: [x, y, 0.022] }));
    }
    // Bracket arm + scroll (secondary, silhouette-defining).
    mount.add(k.mesh(k.geo.box(0.025, 0.025, p.reach, { bevel: 0.004 }), iron, { at: [0, 0.6, p.reach / 2 + 0.02] }));
    const scroll = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const a = t * Math.PI * 1.4;
      scroll.push([0, 0.6 - 0.03 - Math.sin(t * Math.PI) * 0.12 - (1 - Math.cos(a)) * 0.012, 0.03 + t * p.reach * 0.8]);
    }
    mount.add(k.mesh(k.geo.tube(scroll, 0.008, { segments: 24, radialSegments: 6 }), iron));
    mount.add(k.mesh(k.geo.torus(0.025, 0.006, { axis: 'x', tubularSegments: 14, radialSegments: 5 }), iron, { at: [0, 0.565, p.reach - 0.02] }));

    // Lantern (focal): hood, glass, corner posts, pan.
    const lantern = k.part('lantern');
    const cz = p.reach - 0.02;
    const top = 0.53;
    lantern.add(k.mesh(k.geo.cone(s * 0.62, s * 0.38, { segments: 4, base: true, flat: true }), iron, { at: [0, top - s * 0.38, cz], rot: [0, Math.PI / 4, 0] }));
    lantern.add(k.mesh(k.geo.lathe([[0, 0], [0.018, 0], [0.012, 0.03], [0.02, 0.05], [0, 0.09]], { segments: 8 }), iron, { at: [0, top, cz] }));
    lantern.add(k.mesh(k.geo.box(s * 0.82, 0.025, s * 0.82, { bevel: 0.005 }), iron, { at: [0, top - s * 0.38 - 0.0125, cz] }));
    const gh = s * 0.95;
    const gy = top - s * 0.38 - 0.025 - gh / 2;
    lantern.add(k.mesh(k.geo.box(s * 0.62, gh, s * 0.62), glass, { at: [0, gy, cz] }));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) lantern.add(k.mesh(k.geo.box(0.02, gh + 0.01, 0.02, { bevel: 0.004 }), iron, { at: [sx * s * 0.33, gy, cz + sz * s * 0.33] }));
    }
    for (const [dx, dz, w, d] of [[0, s * 0.33, s * 0.66, 0.01], [0, -s * 0.33, s * 0.66, 0.01], [s * 0.33, 0, 0.01, s * 0.66], [-s * 0.33, 0, 0.01, s * 0.66]]) {
      lantern.add(k.mesh(k.geo.box(w, 0.012, d), iron, { at: [dx, gy, cz + dz] }));
    }
    lantern.add(k.mesh(k.geo.cylinder(s * 0.38, 0.035, { radiusTop: s * 0.45, segments: 4, flat: true, base: true }), iron, { at: [0, gy - gh / 2 - 0.035, cz], rot: [0, Math.PI / 4, 0] }));
    lantern.add(k.mesh(k.geo.cone(0.022, 0.05, { segments: 8, base: true }), iron, { at: [0, gy - gh / 2 - 0.035, cz], rot: [Math.PI, 0, 0] }));
    asset.add(mount, lantern);
    return asset;
  },
});
