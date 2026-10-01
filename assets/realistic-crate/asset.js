// Realistic Wooden Crate
// Prompt: "Realistic wooden shipping crate with metal corner brackets and worn planks"
import { defineAsset } from '../../studio/kit/index.js';

export default defineAsset({
  meta: {
    title: 'Realistic Wooden Crate',
    prompt: 'Realistic wooden shipping crate with metal corner brackets and worn planks',
    interpretation: '0.8 m pine shipping crate: horizontal planks with gaps over a dark inner box, edge battens and a diagonal brace on two faces, galvanized steel corner brackets with bolts. Baked wood-grain texture with stains and scratches, normal map from a height pass, roughness variation.',
    style: ['realistic'],
    category: 'container',
    budget: { triangles: 4000 },
  },
  seed: 5150,
  params: {
    size: 0.8,
    planksPerFace: 4,
    plankGap: 0.008,
    plankThickness: 0.02,
    battenWidth: 0.07,
    battenThickness: 0.022,
    bracketSize: 0.11,
    textureSize: 512,
    wear: 0.5, // 0 = new, 1 = very worn
  },
  build({ p, k, rng }) {
    const asset = k.asset('crate');
    const S = p.size;
    const h = S / 2;

    // --- textures: tiling pine (1 texture repeat per meter of surface)
    const T = p.textureSize;
    const color = k.tex.create(T, T, { name: 'crate_wood', seed: 11 })
      .fill('#c39667')
      .noise({ color: '#a8794a', scale: 4, octaves: 4, amount: 0.5, stretch: [1, 10] })
      .grain({ color: '#8a6038', rings: 26, amount: 0.32, warp: 0.45, scale: 3, fine: 0.4, seed: 7 }) // same seed as the height grain
      .noise({ color: '#e0c08f', scale: 6, octaves: 3, amount: 0.18, stretch: [1, 16], mode: 'screen' })
      .stains({ count: Math.round(3 + 8 * p.wear), radius: [0.025, 0.07], color: '#5e4127', alpha: 0.12 + 0.16 * p.wear })
      .scratches({ count: Math.round(20 + 50 * p.wear), color: '#e4c79d', alpha: 0.22, width: 0.0012 })
      .dirt({ color: '#4a3a2a', amount: 0.22 * p.wear, scale: 4 });
    const height = k.tex.create(T, T, { space: 'linear', name: 'crate_height', seed: 12 })
      .fill(0.6)
      .grain({ color: 0.4, rings: 26, amount: 0.5, warp: 0.45, scale: 3, fine: 0.4, seed: 7 })
      .scratches({ count: Math.round(20 + 50 * p.wear), color: 0.32, alpha: 0.6, width: 0.0012, seed: 99 })
      .blur(1);
    const normal = k.tex.normalFromHeight(height, { strength: 1.4 });
    const rough = k.tex.create(T, T, { space: 'linear', name: 'crate_rough', seed: 13 })
      .fill(0.78)
      .noise({ color: 0.9, scale: 4, amount: 0.6 })
      .noise({ color: 0.62, scale: 9, amount: 0.3 * p.wear });
    const orm = k.tex.orm({ roughness: rough, metalness: 0 });
    const wood = k.mat.pbr({ name: 'pine', color: '#ffffff', map: color, normalMap: normal, normalScale: 1, ormMap: orm, roughness: 1, metalness: 0 });
    const inner = k.mat.pbr({ name: 'crate_inner', color: '#2a1f16', roughness: 0.95 });
    const steel = k.mat.physical('steel', { name: 'galvanized_steel', color: '#a9adb1', roughness: 0.48 });
    const bolt = k.mat.physical('dark-iron', { name: 'bolt', roughness: 0.6 });

    const body = k.part('body');
    // Inner box (visible through plank gaps).
    body.add(k.mesh(k.geo.box(S - 0.03, S - 0.03, S - 0.03), inner, { at: [0, h, 0] }));

    // Planks on the 4 sides + top, horizontal; grain runs along each plank.
    const pr = rng.stream('planks');
    const plankW = (S - 2 * p.battenWidth * 0.3 - (p.planksPerFace - 1) * p.plankGap) / p.planksPerFace;
    const faces = [
      { n: [0, 0, 1], len: S, rotY: 0 },
      { n: [0, 0, -1], len: S, rotY: Math.PI },
      { n: [1, 0, 0], len: S - 2 * p.plankThickness, rotY: Math.PI / 2 },
      { n: [-1, 0, 0], len: S - 2 * p.plankThickness, rotY: -Math.PI / 2 },
    ];
    for (const f of faces) {
      for (let i = 0; i < p.planksPerFace; i++) {
        const y = p.battenWidth * 0.3 + plankW / 2 + i * (plankW + p.plankGap);
        let g = k.geo.plank(f.len, plankW, p.plankThickness, { seed: pr.int(0, 1e6), warp: 0.006 * p.wear, bevel: 0.004 });
        g = k.op.rotate(g, 0, f.rotY, 0);
        const off = h - p.plankThickness / 2;
        g = k.op.translate(g, f.n[0] * off, y, f.n[2] * off);
        g = k.uv.box(g, { scale: 1, offset: [pr.range(0, 1), pr.range(0, 1)] });
        body.add(k.mesh(g, wood));
      }
    }
    // Top planks run along X.
    for (let i = 0; i < p.planksPerFace; i++) {
      const z = -h + plankW / 2 + i * (plankW + p.plankGap) + p.battenWidth * 0.15;
      let g = k.geo.plank(S, p.plankThickness, plankW, { seed: pr.int(0, 1e6), warp: 0.004 * p.wear, bevel: 0.004 });
      g = k.op.translate(g, 0, S - p.plankThickness / 2, z);
      g = k.uv.box(g, { scale: 1, offset: [pr.range(0, 1), pr.range(0, 1)] });
      body.add(k.mesh(g, wood));
    }

    // Edge battens (vertical on the corners, horizontal around top and bottom of front/back).
    const bw = p.battenWidth;
    const bt = p.battenThickness;
    const frame = k.part('frame');
    const vert = (x, z) => {
      let g = k.geo.box(bw, S, bt, { bevel: 0.005 });
      g = k.uv.rotate(k.uv.box(g, { scale: 1 }), Math.PI / 2); // grain runs vertically
      return k.mesh(g, wood, { at: [x, h, z] });
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.add(vert(sx * (h - bw / 2), sz * (h + bt / 2 - 0.001)));
    for (const sz of [-1, 1]) {
      for (const y of [bw / 2, S - bw / 2]) {
        frame.add(k.mesh(k.uv.box(k.geo.box(S - 2 * bw, bw, bt, { bevel: 0.005 }), { scale: 1, offset: [0.37, y] }), wood, { at: [0, y, sz * (h + bt / 2 - 0.001)] }));
      }
      // Diagonal brace.
      const diagLen = Math.hypot(S - 2 * bw, S - 2 * bw) - bw * 0.9;
      let d = k.geo.box(diagLen, bw * 0.9, bt * 0.9, { bevel: 0.005 });
      d = k.uv.box(d, { scale: 1, offset: [0.61, 0.2] });
      d = k.op.rotate(d, 0, 0, sz * Math.PI / 4);
      frame.add(k.mesh(d, wood, { at: [0, h, sz * (h + bt * 0.45)] }));
    }

    // Corner brackets: three plates per top/bottom corner with bolts.
    const brackets = k.part('brackets');
    const b = p.bracketSize;
    const t = 0.003;
    const off = h + bt + t / 2;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const top of [false, true]) {
          const y = top ? S - b / 2 + 0.002 : b / 2 - 0.002;
          brackets.add(k.mesh(k.geo.box(b, b, t, { bevel: 0.001 }), steel, { at: [sx * (h - b / 2 + 0.004), y, sz * off] }));
          brackets.add(k.mesh(k.geo.box(t, b, b, { bevel: 0.001 }), steel, { at: [sx * (h + t / 2 + 0.001), y, sz * (h - b / 2 + 0.004)] }));
          for (const [bx, by] of [[0.3, 0.3], [0.7, 0.7]]) {
            const px = sx * (h - b * bx);
            const py = top ? S - b * by : b * by;
            brackets.add(k.mesh(k.geo.cylinder(0.008, 0.006, { segments: 6, bevel: 0.002 }), bolt, { at: [px, py, sz * (off + 0.003)], rot: [Math.PI / 2, 0, 0] }));
          }
        }
      }
    }
    asset.add(body, frame, brackets);
    return asset;
  },
});
