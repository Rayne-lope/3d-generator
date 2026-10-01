// Steampunk Pressure Valve
// Prompt: "Steampunk brass pressure valve with a gauge and copper pipes"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Steampunk Pressure Valve',
    prompt: 'Steampunk brass pressure valve with a gauge and copper pipes',
    interpretation: '0.9 m floor-standing assembly: copper riser pipe with bolted flanges, a round brass valve body with a spoked handwheel on the front, an elbow pipe out the side, and a pressure gauge with a painted dial (ticks, red zone, needle) behind a bezel. Metals are true metallic PBR (slightly rough so they read without reflections).',
    style: ['steampunk', 'realistic'],
    category: 'prop',
    budget: { triangles: 7000 },
  },
  seed: 1887,
  params: {
    height: 0.9,
    pipeRadius: 0.045,
    wheelRadius: 0.13,
    gaugeRadius: 0.08,
    brass: '#c9a24a',
    copper: '#c27a52',
    needle: 0.72, // needle position 0..1 along the dial
  },
  variants: {
    'red-zone': { needle: 0.93 },
  },
  build({ p, k }) {
    const asset = k.asset('pressure_valve');
    const brass = k.mat.pbr({ name: 'brass', color: p.brass, roughness: 0.38, metalness: 1 });
    const copper = k.mat.pbr({ name: 'copper', color: p.copper, roughness: 0.42, metalness: 1 });
    const iron = k.mat.pbr({ name: 'cast_iron', color: '#3a3836', roughness: 0.7, metalness: 1 });
    const H = p.height;
    const R = p.pipeRadius;

    const pipes = k.part('pipes');
    // Floor flange + riser.
    pipes.add(k.mesh(k.geo.cylinder(0.14, 0.03, { segments: 20, bevel: 0.006, base: true }), iron));
    pipes.add(k.mesh(k.geo.cylinder(R, H * 0.45, { segments: 16, base: true }), copper, { at: [0, 0.03, 0] }));
    const flange = (y) => {
      pipes.add(k.mesh(k.geo.cylinder(R * 1.9, 0.022, { segments: 20, bevel: 0.004 }), brass, { at: [0, y, 0] }));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pipes.add(k.mesh(k.geo.prism(6, 0.009, 0.034), iron, { at: [Math.cos(a) * R * 1.55, y, Math.sin(a) * R * 1.55] }));
      }
    };
    flange(0.06);
    flange(H * 0.45);
    // Valve body: sphere with collars.
    const vy = H * 0.58;
    pipes.add(k.mesh(k.geo.sphere(R * 2.3, { widthSegments: 24, heightSegments: 16 }), brass, { at: [0, vy, 0] }));
    pipes.add(k.mesh(k.geo.cylinder(R * 1.25, 0.08, { segments: 16, bevel: 0.006 }), brass, { at: [0, vy - R * 2.3, 0] }));
    // Upper pipe to an elbow going sideways.
    pipes.add(k.mesh(k.geo.cylinder(R, H * 0.2, { segments: 16, base: true }), copper, { at: [0, vy + R * 1.8, 0] }));
    const elbowY = vy + R * 1.8 + H * 0.2;
    const elbow = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * (Math.PI / 2);
      elbow.push([0.09 - Math.cos(a) * 0.09, elbowY + Math.sin(a) * 0.09, 0]);
    }
    elbow.push([0.35, elbowY + 0.09, 0]);
    pipes.add(k.mesh(k.geo.tube(elbow, R, { segments: 24, radialSegments: 14, tension: 0 }), copper));
    pipes.add(k.mesh(k.geo.cylinder(R * 1.6, 0.02, { segments: 18, bevel: 0.004 }), brass, { at: [0.35, elbowY + 0.09, 0], rot: [0, 0, Math.PI / 2] }));

    // Handwheel on the front of the valve: rim + hub + spokes.
    const wheel = k.part('handwheel', { separate: true, pivot: [0, vy, R * 2.3 + 0.07] });
    const wz = R * 2.3 + 0.07;
    wheel.add(k.mesh(k.geo.torus(p.wheelRadius, 0.012, { axis: 'z', tubularSegments: 32, radialSegments: 8 }), iron, { at: [0, vy, wz] }));
    wheel.add(k.mesh(k.geo.cylinder(0.025, 0.05, { segments: 12, bevel: 0.005 }), brass, { at: [0, vy, wz - 0.01], rot: [Math.PI / 2, 0, 0] }));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      wheel.add(k.mesh(k.geo.box(p.wheelRadius, 0.012, 0.012, { bevel: 0.003 }), iron, { at: [Math.cos(a) * p.wheelRadius / 2, vy + Math.sin(a) * p.wheelRadius / 2, wz], rot: [0, 0, a] }));
    }
    pipes.add(k.mesh(k.geo.cylinder(0.012, 0.07, { segments: 8 }), iron, { at: [0, vy, R * 2.3 + 0.035], rot: [Math.PI / 2, 0, 0] }));

    // Gauge: painted dial texture on the face, bezel ring, short stem.
    const gauge = k.part('gauge');
    const gy = elbowY + 0.2;
    const G = p.gaugeRadius;
    gauge.add(k.mesh(k.geo.cylinder(0.015, 0.11, { segments: 10, base: true }), copper, { at: [0, elbowY + 0.03, 0] }));
    const dial = k.tex.create(256, 256, { name: 'gauge_dial', layout: 'atlas', seed: 5 }).fill('#efe6cf');
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI * 0.75 + (i / 20) * Math.PI * 1.5;
      const r0 = i % 5 === 0 ? 0.33 : 0.37;
      dial.line(0.5 + Math.cos(a) * r0, 0.5 + Math.sin(a) * r0, 0.5 + Math.cos(a) * 0.42, 0.5 + Math.sin(a) * 0.42, i % 5 === 0 ? 0.012 : 0.006, '#2a2420');
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.PI * 0.75 + (0.82 + (i / 24) * 0.18) * Math.PI * 1.5;
      dial.circle(0.5 + Math.cos(a) * 0.4, 0.5 + Math.sin(a) * 0.4, 0.018, '#c0392b');
    }
    const na = Math.PI * 0.75 + p.needle * Math.PI * 1.5;
    dial.line(0.5, 0.5, 0.5 + Math.cos(na) * 0.36, 0.5 + Math.sin(na) * 0.36, 0.016, '#1a1a1a').circle(0.5, 0.5, 0.04, '#3a3530');
    const dialMat = k.mat.pbr({ name: 'gauge_dial', map: dial, roughness: 0.4 });
    // Dial: a flat disc facing +Z in front of the closed bezel (its back is never visible).
    let face = k.geo.disc(G * 0.92, { segments: 32 });
    face = k.op.rotate(face, Math.PI / 2, 0, 0);
    face = k.uv.planar(face, { axis: 'z', scale: 1 / (2 * G * 0.92) });
    face = k.uv.offset(face, 0.5, 0.5);
    gauge.add(k.mesh(face, dialMat, { at: [0, gy, 0.0065] }));
    gauge.add(k.mesh(k.geo.cylinder(G, 0.035, { segments: 24, bevel: 0.006 }), brass, { at: [0, gy, -0.012], rot: [Math.PI / 2, 0, 0] }));
    gauge.add(k.mesh(k.geo.torus(G * 0.95, 0.009, { axis: 'z', tubularSegments: 32, radialSegments: 6 }), brass, { at: [0, gy, 0.016] }));
    asset.add(pipes, wheel, gauge);
    return asset;
  },
});
