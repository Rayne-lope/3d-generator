// Cartoon Mailbox
// Prompt: "Cartoon mailbox with exaggerated proportions and bright colors"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Cartoon Mailbox',
    prompt: 'Cartoon mailbox with exaggerated proportions and bright colors',
    interpretation: 'Chunky rural mailbox (1.25 m tall): oversized rounded box in bright blue on a crooked wooden post, big front door with a yellow knob, a red flag on a hinged arm (separate part, pivot at the hinge), thick soft bevels everywhere.',
    style: ['cartoon', 'stylized'],
    category: 'prop',
    budget: { triangles: 4000 },
  },
  seed: 1999,
  params: {
    boxLength: 0.7,
    boxWidth: 0.42,
    boxHeight: 0.46,
    postHeight: 0.8,
    lean: 0.09,
    flagUp: true,
    body: '#2f7de1',
    door: '#5ea0f5',
    flag: '#e8443a',
    knob: '#ffd23f',
    post: '#a8743f',
  },
  variants: {
    'flag-down': { flagUp: false },
    pink: { body: '#e85d9a', door: '#f59ac2', flag: '#3fc1ff', seed: 3 },
  },
  build({ p, k }) {
    const asset = k.asset('mailbox');
    const body = k.mat.pbr({ name: 'mailbox_paint', color: p.body, roughness: 0.4 });
    const door = k.mat.pbr({ name: 'door_paint', color: p.door, roughness: 0.4 });
    const flagMat = k.mat.pbr({ name: 'flag_paint', color: p.flag, roughness: 0.45 });
    const knob = k.mat.pbr({ name: 'knob', color: p.knob, roughness: 0.35 });
    const wood = k.mat.pbr({ name: 'post_wood', color: p.post, roughness: 0.8 });
    const dark = k.mat.pbr({ name: 'mouth', color: '#1b2a3d', roughness: 0.9 });

    // Crooked post: a plank bent sideways, on a chunky foot.
    const post = k.part('post');
    let pg = k.geo.box(0.15, p.postHeight, 0.15, { bevel: 0.03, base: true });
    pg = k.op.bend(pg, { axis: 'y', toward: 'x', angle: p.lean });
    post.add(k.mesh(pg, wood));
    post.add(k.mesh(k.geo.box(0.26, 0.06, 0.26, { bevel: 0.025, base: true }), wood));
    const topX = p.postHeight * Math.sin(p.lean / 2) * 1.0;
    post.add(k.mesh(k.geo.box(0.2, 0.05, p.boxLength * 0.6, { bevel: 0.015 }), wood, { at: [topX, p.postHeight + 0.01, 0] }));

    // Box: arch profile extruded along Z (front faces +Z), slightly squashed for a cartoon look.
    const box = k.part('box');
    const W = p.boxWidth;
    const archShape = k.shape.arch(W, p.boxHeight, { segments: 18 });
    let bg = k.geo.extrude(archShape, p.boxLength, { bevel: 0.03, bevelSegments: 3, axis: 'z' });
    bg = k.op.translate(bg, topX, p.postHeight + 0.035 + 0.03, -0.02);
    box.add(k.mesh(bg, body));
    // Front door (slightly proud) with a dark slot rim and a big knob.
    const front = p.boxLength / 2 - 0.02 + 0.03;
    let dg = k.geo.extrude(k.shape.arch(W * 0.86, p.boxHeight * 0.88, { segments: 18 }), 0.03, { bevel: 0.012, bevelSegments: 2 });
    dg = k.op.translate(dg, topX, p.postHeight + 0.065 + p.boxHeight * 0.05, front + 0.02);
    box.add(k.mesh(dg, door));
    box.add(k.mesh(k.geo.sphere(0.035, { widthSegments: 12, heightSegments: 8 }), knob, { at: [topX, p.postHeight + 0.065 + p.boxHeight * 0.62, front + 0.055] }));
    box.add(k.mesh(k.geo.box(W * 0.5, 0.02, 0.01, { bevel: 0.004 }), dark, { at: [topX, p.postHeight + 0.065 + p.boxHeight * 0.3, front + 0.04] }));

    // Flag on a hinged arm: separate part so it can rotate in the engine.
    const hingeY = p.postHeight + 0.065 + p.boxHeight * 0.35;
    const hingeX = topX + W / 2 + 0.035;
    const flag = k.part('flag', { separate: true, pivot: [hingeX, hingeY, 0.05] });
    flag.add(k.mesh(k.geo.box(0.03, 0.34, 0.03, { bevel: 0.008 }), flagMat, { at: [hingeX, hingeY + 0.14, 0.05] }));
    flag.add(k.mesh(k.geo.box(0.025, 0.12, 0.16, { bevel: 0.01 }), flagMat, { at: [hingeX, hingeY + 0.26, 0.12] }));
    flag.add(k.mesh(k.geo.cylinder(0.03, 0.04, { segments: 12, bevel: 0.006 }), knob, { at: [hingeX - 0.01, hingeY, 0.05], rot: [0, 0, Math.PI / 2] }));
    if (!p.flagUp) flag.rotation.x = Math.PI / 2; // lowered: arm points forward
    asset.add(post, box, flag);
    return asset;
  },
});
