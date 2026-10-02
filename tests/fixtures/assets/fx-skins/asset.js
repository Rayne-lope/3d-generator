import { defineAsset } from '../../../../studio/kit/index.js';

// Skins fixture: two flat metal materials that look identical in the base look (they must
// stay separate materials and keep their own palette swatch), one textured atlas panel, and
// two skins that break the skin lock on purpose.
export default defineAsset({
  meta: { title: 'Skins Test', category: 'prop', origin: 'base-center' },
  seed: 3,
  params: { width: 0.4, bodyColor: '#7a5230', trimColor: '#c9a34a', capColor: '#c9a34a', panelTint: '#d8d8d8', texturedCap: false },
  skins: {
    paint: { bodyColor: '#3d5a80', trimColor: '#222222', capColor: '#8a1c1c', panelTint: '#ff8844' },
    'bad-shape': { width: 0.5 },
    'bad-material': { texturedCap: true },
  },
  build({ p, k }) {
    const a = k.asset('skins_test');
    const body = k.mat.pbr({ name: 'body', color: p.bodyColor, roughness: 0.7 });
    const trim = k.mat.pbr({ name: 'trim', color: p.trimColor, roughness: 0.4, metalness: 1 });
    const cap = p.texturedCap
      ? k.mat.pbr({ name: 'cap', map: k.tex.create(16, 16, { name: 'cap-tex' }).fill(p.capColor), roughness: 0.4, metalness: 1 })
      : k.mat.pbr({ name: 'cap', color: p.capColor, roughness: 0.4, metalness: 1 });
    const panelGeo = k.uv.unwrap(k.op.translate(k.geo.box(p.width * 0.6, 0.12, 0.02), 0, 0.15, 0.16));
    k.uv.atlas({ panel: panelGeo }, { size: 128, padding: 12 });
    const tex = k.tex.create(128, 128, { layout: 'atlas', name: 'panel' }).fill(p.panelTint);
    const bake = k.bake.surface({ panel: panelGeo });
    tex.paint3d(bake, k.tex.pattern.camo({ colors: [p.panelTint, '#333333'], scale: 0.04, seed: 5 }));
    const panel = k.mat.pbr({ name: 'panel', map: tex, roughness: 0.6 });
    a.add(k.mesh(k.geo.box(p.width, 0.3, 0.3, { base: true }), body));
    a.add(k.mesh(k.geo.box(p.width + 0.02, 0.03, 0.32, { base: true }), trim, { at: [0, 0.3, 0] }));
    a.add(k.mesh(k.geo.cylinder(0.05, 0.04, { base: true }), cap, { at: [0, 0.33, 0] }));
    a.add(k.mesh(panelGeo, panel));
    return a;
  },
});
