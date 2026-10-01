// Fixture: two quads packed into a 256 px atlas with 14 px padding.
import { defineAsset } from '../../../../studio/kit/index.js';
export default defineAsset({
  meta: { title: 'fx padding ok', category: 'prop' },
  build({ k }) {
    const a = k.asset('fx');
    const left = k.uv.unwrap(k.op.translate(k.geo.box(0.6, 0.6, 0.02), -0.4, 0.3, 0));
    const right = k.uv.unwrap(k.op.translate(k.geo.box(0.6, 0.6, 0.02), 0.4, 0.3, 0));
    const layout = k.uv.atlas({ left, right }, { size: 256, padding: 14 });
    const tex = k.tex.create(256, 256, { layout: 'atlas' }).fill('#333333');
    for (const r of layout.rects('left')) tex.clip(r, (t) => t.fill('#ff0000'));
    for (const r of layout.rects('right')) tex.clip(r, (t) => t.fill('#00ff00'));
    const m = k.mat.pbr({ name: 'atlas', map: tex });
    a.add(k.mesh(left, m), k.mesh(right, m));
    return a;
  },
});
