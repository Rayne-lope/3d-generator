// Fixture: a box with a hinged lid, two attachments and three collision shapes.
import { defineAsset } from '../../../../studio/kit/index.js';

export default defineAsset({
  meta: { title: 'Markers fixture', category: 'prop' },
  params: { lidOpen: 0, far: false },
  variants: { open: { lidOpen: 0.5 }, far: { far: true } },
  build({ p, k }) {
    const asset = k.asset('fx_markers');
    const mat = k.mat.pbr({ name: 'gray', color: '#888888', roughness: 0.8 });
    const body = k.part('base');
    body.add(k.mesh(k.geo.box(1, 0.5, 0.6), mat, { at: [0, 0.25, 0] }));
    // On the merged body: 10 cm in front of the box, pointing +X.
    body.add(k.attach('handle', { at: [0.5, 0.25, 0], forward: [1, 0, 0] }));
    body.add(k.collider.box(1, 0.5, 0.6, { at: [0, 0.25, 0] }));
    body.add(k.collider.cylinder(0.1, 0.4, { at: [0.3, 0.25, 0], rot: [0, 0, Math.PI / 2], name: 'bar' }));
    if (p.far) body.add(k.collider.sphere(0.1, { at: [5, 0.25, 0] }));
    asset.add(body);
    // A separate lid, hinged on its back edge: its markers move with it.
    const lid = k.part('lid', { separate: true, pivot: [0, 0.5, -0.3] });
    lid.add(k.mesh(k.geo.box(1, 0.1, 0.6), mat, { at: [0, 0.55, 0] }));
    lid.add(k.attach('latch', { at: [0, 0.55, 0.3] }));
    lid.add(k.collider.sphere(0.05, { at: [0, 0.6, 0] }));
    if (p.lidOpen) lid.rotation.x = -p.lidOpen;
    asset.add(lid);
    return asset;
  },
});
