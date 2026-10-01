import { defineAsset } from '../../../../studio/kit/index.js';

export default defineAsset({
  meta: { title: 'Kit Test', category: 'prop', origin: 'base-center' },
  seed: 7,
  params: {},
  build({ k }) {
    const a = k.asset('kit_test');
    const red = k.mat.pbr({ name: 'red', color: '#c0392b', roughness: 0.5 });
    const blue = k.mat.pbr({ name: 'blue', color: '#2e6fb5', roughness: 0.5 });
    const green = k.mat.pbr({ name: 'green', color: '#3f9a4f', roughness: 0.6 });
    const metal = k.mat.physical('iron');
    const row = (i) => [i * 0.7, 0, 0];
    a.add(k.mesh(k.geo.box(0.5, 0.5, 0.5, { bevel: 0.05, base: true }), red, { at: row(0) }));
    a.add(k.mesh(k.geo.box(0.5, 0.5, 0.5, { bevel: 0.08, smooth: true, base: true }), blue, { at: row(1) }));
    a.add(k.mesh(k.geo.cylinder(0.25, 0.5, { bevel: 0.03, base: true }), green, { at: row(2) }));
    a.add(k.mesh(k.geo.cone(0.25, 0.5, { base: true }), red, { at: row(3) }));
    a.add(k.mesh(k.geo.prism(6, 0.25, 0.5, { base: true, bevel: 0.02 }), blue, { at: row(4) }));
    a.add(k.mesh(k.geo.washer(0.25, 0.18, 0.12, { base: true, bevel: 0.01 }), metal, { at: row(5) }));
    a.add(k.mesh(k.geo.torus(0.2, 0.06), green, { at: [row(6)[0], 0.06, 0] }));
    a.add(k.mesh(k.geo.sphere(0.25, { base: true }), red, { at: row(7) }));
    a.add(k.mesh(k.geo.icosphere(0.25, 1, { base: true }), blue, { at: row(8) }));
    const r2 = (i) => [i * 0.7, 0, -0.8];
    a.add(k.mesh(k.geo.capsule(0.12, 0.3, { base: true }), green, { at: r2(0) }));
    a.add(k.mesh(k.geo.tube([[0, 0.05, 0], [0.15, 0.3, 0], [0, 0.5, 0.1]], 0.05), metal, { at: r2(1) }));
    a.add(k.mesh(k.geo.extrude(k.shape.star(5, 0.25, 0.11), 0.12, { bevel: 0.015, axis: 'y' }), red, { at: r2(2) }));
    a.add(k.mesh(k.geo.wedge(0.5, 0.4, 0.5, { base: true }), blue, { at: r2(3) }));
    a.add(k.mesh(k.geo.rock(0.25, { seed: 3, base: true }), green, { at: r2(4) }));
    a.add(k.mesh(k.geo.plank(0.6, 0.05, 0.15, { seed: 2, base: true }), red, { at: r2(5) }));
    a.add(k.mesh(k.op.bulge(k.geo.cylinder(0.22, 0.55, { base: true, segments: 16 }), { amount: 0.15 }), blue, { at: r2(6) }));
    a.add(k.mesh(k.op.twist(k.geo.box(0.2, 0.6, 0.2, { base: true }), { angle: 1.2 }), green, { at: r2(7) }));
    const holey = k.csg.subtract(k.geo.box(0.5, 0.5, 0.5, { base: true }), k.op.translate(k.geo.cylinder(0.15, 0.8, { segments: 20 }), 0, 0.25, 0));
    a.add(k.mesh(holey, red, { at: r2(8) }));
    return a;
  },
});
