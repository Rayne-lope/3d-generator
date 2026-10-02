// Headless capture page (driven by Playwright from studio/core/render/capture.js).
// Uses the same scene setup as the live viewport. Two sources can be rendered:
//  - 'glb'    the exported file, loaded through GLTFLoader (what engines get)
//  - 'source' the original three.js scene, built in the browser from the same asset module
// Comparing them from identical cameras is the parity check.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRenderer, applyLighting, contentBox, frameCamera, forceSingleSided, setOverlays, unitsPerMeter, BACKGROUND, VIEWS } from './scene-setup.js';

const canvas = document.getElementById('c');
const renderer = createRenderer(canvas, { preserveDrawingBuffer: true, antialias: true });
renderer.setPixelRatio(1);
const loader = new GLTFLoader();

async function loadGLB(url) {
  const gltf = await loader.loadAsync(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
  forceSingleSided(gltf.scene);
  return { object: gltf.scene, units: unitsPerMeter(gltf) };
}

async function loadSource(slug, variant, skin) {
  const kit = await import('/studio/kit/index.js');
  const mod = await import(`/assets/${slug}/asset.js?t=${Date.now()}`);
  const { root } = kit.runAsset(mod.default, { variant: variant || null, skin: skin || null });
  return { object: root, units: 1 };
}

// frameBox ({min, max} in file units) frames every render with the same camera, so two
// versions of an asset can be compared pixel by pixel (version diffs).
function renderViews(object, { views, size, lighting = 'neutral', frameBox = null }) {
  renderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.add(object);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  const box = frameBox ? new THREE.Box3(new THREE.Vector3(...frameBox.min), new THREE.Vector3(...frameBox.max)) : contentBox(object);
  const own = frameBox ? contentBox(object) : box;
  applyLighting(renderer, scene, lighting, { size: box.getSize(new THREE.Vector3()).length() || 1 });
  const images = {};
  for (const v of views) {
    setOverlays(object, { wire: v === 'iso-wire' });
    frameCamera(camera, box, v);
    renderer.render(scene, camera);
    images[v] = canvas.toDataURL('image/png');
  }
  setOverlays(object, {});
  scene.remove(object);
  return { images, bbox: { min: own.min.toArray(), max: own.max.toArray() } };
}

function drawLabel(ctx, text, x, y, { size = 13, align = 'left', bg = 'rgba(20,22,26,0.75)', color = '#fff' } = {}) {
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 10;
  const bx = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = bg;
  ctx.fillRect(bx, y, w, size + 8);
  ctx.fillStyle = color;
  ctx.fillText(text, bx + 5, y + size + 1);
}

function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

window.studioCapture = {
  /** What the headless browser renders with (used by node studio doctor). */
  webglInfo() {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: renderer.capabilities.isWebGL2 !== false,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
  },

  async renderGLB({ url, views, size = 512, lighting = 'neutral', frameBox = null }) {
    const { object, units } = await loadGLB(url);
    return { ...renderViews(object, { views, size, lighting, frameBox }), units };
  },

  /** Bounding box of a GLB without rendering (used to build a shared frame for diffs). */
  async boxGLB({ url }) {
    const { object, units } = await loadGLB(url);
    const box = contentBox(object);
    return { min: box.min.toArray(), max: box.max.toArray(), units };
  },

  async renderSource({ slug, variant = null, skin = null, views, size = 512, lighting = 'neutral', frameBox = null }) {
    const { object } = await loadSource(slug, variant, skin);
    return renderViews(object, { views, size, lighting, frameBox });
  },

  /** Compose tiles into one contact sheet with a header. */
  async sheet({ tiles, columns = 3, tileSize = 512, title = '', lines = [] }) {
    const rows = Math.ceil(tiles.length / columns);
    const sc = document.createElement('canvas');
    const ctx = sc.getContext('2d');
    ctx.font = '13px system-ui, sans-serif';
    const W = columns * tileSize;
    const wrapped = lines.flatMap((l) => wrapLines(ctx, l, W - 24)).slice(0, 4);
    const header = 40 + wrapped.length * 18;
    sc.width = W;
    sc.height = header + rows * tileSize;
    ctx.fillStyle = '#1d2024';
    ctx.fillRect(0, 0, sc.width, sc.height);
    ctx.fillStyle = '#ffc857';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText(title, 12, 26);
    ctx.fillStyle = '#c9d0d8';
    ctx.font = '13px system-ui, sans-serif';
    wrapped.forEach((l, i) => ctx.fillText(l, 12, 48 + i * 18));
    for (let i = 0; i < tiles.length; i++) {
      const img = await loadImage(tiles[i].image);
      const x = (i % columns) * tileSize;
      const y = header + Math.floor(i / columns) * tileSize;
      ctx.drawImage(img, x, y, tileSize, tileSize);
      ctx.strokeStyle = '#1d2024';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, tileSize, tileSize);
      drawLabel(ctx, tiles[i].label, x + 8, y + 8);
    }
    return sc.toDataURL('image/png');
  },

  /** Several GLBs side by side at true relative scale (meters), with labels and a 1.75 m human. */
  async lineup({ items, width = 1400, height = 700, lighting = 'neutral', human = true }) {
    // Labels go in a strip under the render (two alternating rows), so they never cover the
    // models or fall off the image.
    const strip = 64;
    const viewH = height - strip;
    renderer.setSize(width, viewH, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    const placed = [];
    let x = 0;
    const loaded = [];
    for (const it of items) {
      const { object, units } = await loadGLB(it.url);
      const holder = new THREE.Group();
      holder.add(object);
      holder.scale.setScalar(1 / units);
      loaded.push({ holder, label: it.label });
    }
    const sizes = loaded.map((l) => contentBox(l.holder).getSize(new THREE.Vector3()));
    const gap = Math.max(0.15, (sizes.reduce((s, v) => s + v.x, 0) / Math.max(1, sizes.length)) * 0.35);
    loaded.forEach((l, i) => {
      const box = contentBox(l.holder);
      l.holder.position.x = x - box.min.x;
      l.holder.position.z = -(box.min.z + box.max.z) / 2;
      scene.add(l.holder);
      placed.push({ holder: l.holder, label: l.label });
      x += sizes[i].x + gap;
    });
    if (human) {
      const { makeHuman } = await import('./scene-setup.js');
      const h = makeHuman(1);
      h.position.set(x + 0.2, 0, 0);
      scene.add(h);
    }
    scene.updateMatrixWorld(true);
    const all = new THREE.Box3();
    scene.traverse((o) => {
      if (o.isMesh) all.expandByObject(o, true);
    });
    const camera = new THREE.PerspectiveCamera(28, width / viewH, 0.01, 1000);
    applyLighting(renderer, scene, lighting, { size: all.getSize(new THREE.Vector3()).length() || 1 });
    VIEWS.lineup = { dir: [0.18, 0.32, 1], up: [0, 1, 0], label: 'Lineup' };
    frameCamera(camera, all, 'lineup', { fit: 1.04 });
    renderer.render(scene, camera);
    const shot = await loadImage(canvas.toDataURL('image/png'));
    const sc = document.createElement('canvas');
    sc.width = width;
    sc.height = height;
    const ctx = sc.getContext('2d');
    ctx.fillStyle = '#2a2e34';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(shot, 0, 0);
    placed.forEach((p, i) => {
      const box = contentBox(p.holder);
      const v = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, box.max.z).project(camera);
      const px = ((v.x + 1) / 2) * width;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(px, viewH);
      ctx.lineTo(px, viewH + 6 + (i % 2) * 28);
      ctx.stroke();
      drawLabel(ctx, p.label, px, viewH + 6 + (i % 2) * 28, { align: 'center', size: 14 });
    });
    return sc.toDataURL('image/png');
  },
};


// ------------------------------------------------------------------ agent feedback views

const PART_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#a9a9a9', '#ffe119'];

function partOf(o) {
  let cur = o;
  while (cur) {
    if (cur.userData?.studio?.role === 'part') return cur.name;
    cur = cur.parent;
  }
  return 'body';
}

/** Orthographic camera looking along a view, fitted to box (with margin). */
function orthoCamera(box, viewName, aspect = 1, margin = 0.08) {
  const view = VIEWS[viewName] || VIEWS.front;
  const dir = new THREE.Vector3(...view.dir).normalize();
  const up = new THREE.Vector3(...view.up);
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const trueUp = new THREE.Vector3().crossVectors(dir, right).normalize();
  const center = box.getCenter(new THREE.Vector3());
  let hw = 0;
  let hh = 0;
  let depth = 0;
  const c = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    hw = Math.max(hw, Math.abs(c.dot(right)));
    hh = Math.max(hh, Math.abs(c.dot(trueUp)));
    depth = Math.max(depth, Math.abs(c.dot(dir)));
  }
  hw *= 1 + margin;
  hh *= 1 + margin;
  if (hw / hh > aspect) hh = hw / aspect;
  else hw = hh * aspect;
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.001, depth * 4 + 10);
  cam.position.copy(center).addScaledVector(dir, depth * 2 + 1);
  cam.up.copy(trueUp);
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return { cam, center, right, up: trueUp, hw, hh };
}

/** World point → pixel in a size×size orthographic render. */
function orthoPixel(o, p, W, H) {
  const d = p.clone().sub(o.center);
  return [((d.dot(o.right) + o.hw) / (2 * o.hw)) * W, ((o.hh - d.dot(o.up)) / (2 * o.hh)) * H];
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

function fmtLen(m) {
  if (m >= 1) return `${+m.toFixed(2)} m`;
  if (m >= 0.01) return `${+(m * 100).toFixed(1)} cm`;
  return `${+(m * 1000).toFixed(1)} mm`;
}

async function canvasFrom(dataUrl, W, H) {
  const img = await loadImage(dataUrl);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  return { cv, ctx };
}

window.studioCapture.renderParts = async function renderParts({ slug, variant = null, skin = null, views = ['front', 'top', 'iso'], size = 512 }) {
  const { object } = await loadSource(slug, variant, skin);
  const parts = new Map();
  object.updateMatrixWorld(true);
  object.traverse((o) => {
    if (!o.isMesh) return;
    const name = partOf(o);
    if (!parts.has(name)) parts.set(name, { name, color: PART_COLORS[parts.size % PART_COLORS.length], triangles: 0, box: new THREE.Box3() });
    const part = parts.get(name);
    const g = o.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    part.triangles += tris * (o.isInstancedMesh ? o.count : 1);
    part.box.union(new THREE.Box3().setFromObject(o, true));
    o.material = new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.85, metalness: 0, flatShading: false });
  });
  renderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.add(object);
  const box = contentBox(object);
  applyLighting(renderer, scene, 'neutral', { size: box.getSize(new THREE.Vector3()).length() || 1 });
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  const images = {};
  for (const v of views) {
    frameCamera(camera, box, v);
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const { cv, ctx } = await canvasFrom(canvas.toDataURL('image/png'), size, size);
    for (const part of parts.values()) {
      const p = part.box.getCenter(new THREE.Vector3()).project(camera);
      drawLabel(ctx, part.name, ((p.x + 1) / 2) * size, ((1 - p.y) / 2) * size - 10, { align: 'center', size: 12, bg: 'rgba(15,17,20,0.8)', color: part.color });
    }
    images[v] = cv.toDataURL('image/png');
  }
  scene.remove(object);
  // Legend tile.
  const lg = document.createElement('canvas');
  lg.width = size;
  lg.height = size;
  const ctx = lg.getContext('2d');
  ctx.fillStyle = '#1d2024';
  ctx.fillRect(0, 0, size, size);
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillStyle = '#c9d0d8';
  ctx.fillText('Parts (k.part) — source scene, structure only', 14, 54);
  const list = [...parts.values()];
  const row = Math.min(24, Math.floor((size - 80) / Math.max(1, list.length)));
  list.forEach((part, i) => {
    const y = 70 + i * row;
    ctx.fillStyle = part.color;
    ctx.fillRect(14, y, row - 6, row - 6);
    ctx.fillStyle = '#e6e9ee';
    ctx.font = `${Math.max(10, row - 10)}px system-ui, sans-serif`;
    const sz = part.box.getSize(new THREE.Vector3());
    ctx.fillText(`${part.name} · ${part.triangles.toLocaleString('en-US')} tris · ${fmtLen(sz.x)} × ${fmtLen(sz.y)} × ${fmtLen(sz.z)}`, 14 + row, y + row - 10);
  });
  images.legend = lg.toDataURL('image/png');
  return { images, parts: list.map((p) => ({ name: p.name, color: p.color, triangles: p.triangles, min: p.box.min.toArray(), max: p.box.max.toArray() })) };
};

/** Orthographic views of a GLB with a metric grid, rulers and overall dimensions. */
window.studioCapture.blueprint = async function blueprint({ url, views = ['front', 'top', 'right'], size = 640, lighting = 'neutral' }) {
  const { object, units } = await loadGLB(url);
  renderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2b2f35');
  scene.add(object);
  const box = contentBox(object);
  applyLighting(renderer, scene, lighting, { size: box.getSize(new THREE.Vector3()).length() || 1 });
  const images = {};
  const dims = {};
  for (const v of views) {
    const o = orthoCamera(box, v, 1, 0.16);
    renderer.render(scene, o.cam);
    const { cv, ctx } = await canvasFrom(canvas.toDataURL('image/png'), size, size);
    const spanM = (2 * o.hw) / units;
    const step = niceStep(spanM / 10);
    const m2px = size / spanM;
    // Grid anchored at the model's min corner so labels read as distances from it.
    const bmin = orthoPixel(o, box.min.clone(), size, size);
    const bmax = orthoPixel(o, box.max.clone(), size, size);
    const x0 = Math.min(bmin[0], bmax[0]);
    const x1 = Math.max(bmin[0], bmax[0]);
    const y0 = Math.min(bmin[1], bmax[1]);
    const y1 = Math.max(bmin[1], bmax[1]);
    ctx.strokeStyle = 'rgba(120,200,255,0.18)';
    ctx.lineWidth = 1;
    for (let k = -40; k <= 40; k++) {
      const gx = x0 + k * step * m2px;
      const gy = y1 - k * step * m2px;
      if (gx >= 0 && gx <= size) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, size);
        ctx.stroke();
      }
      if (gy >= 0 && gy <= size) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(size, gy);
        ctx.stroke();
      }
    }
    // Rulers along the bottom and left, labeled from the model's min corner.
    ctx.fillStyle = 'rgba(20,22,26,0.85)';
    ctx.fillRect(0, size - 22, size, 22);
    ctx.fillRect(0, 0, 40, size);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#9fd3ff';
    for (let k = 0; k <= 40; k++) {
      const gx = x0 + k * step * m2px;
      if (gx > size - 10) break;
      ctx.fillRect(gx, size - 22, 1, 6);
      if (k % 2 === 0) ctx.fillText(fmtLen(k * step), gx + 2, size - 6);
    }
    for (let k = 0; k <= 40; k++) {
      const gy = y1 - k * step * m2px;
      if (gy < 10) break;
      ctx.fillRect(34, gy, 6, 1);
      if (k % 2 === 0) ctx.fillText(fmtLen(k * step), 2, gy - 2);
    }
    // Overall size of the view.
    ctx.strokeStyle = '#ffc857';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    const w = (x1 - x0) / m2px;
    const h = (y1 - y0) / m2px;
    drawLabel(ctx, fmtLen(w), (x0 + x1) / 2, Math.min(size - 48, y1 + 4), { align: 'center', size: 12, bg: 'rgba(20,22,26,0.85)', color: '#ffc857' });
    drawLabel(ctx, fmtLen(h), Math.min(size - 70, x1 + 6), (y0 + y1) / 2 - 10, { size: 12, bg: 'rgba(20,22,26,0.85)', color: '#ffc857' });
    drawLabel(ctx, `grid ${fmtLen(step)}`, size - 90, 8, { size: 11, bg: 'rgba(20,22,26,0.85)', color: '#9fd3ff' });
    images[v] = cv.toDataURL('image/png');
    dims[v] = { width: +w.toFixed(4), height: +h.toFixed(4), grid: step };
  }
  scene.remove(object);
  return { images, dims, units };
};

function maskFrom(data, W, H, bg, tol) {
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = Math.max(Math.abs(data[i * 4] - bg[0]), Math.abs(data[i * 4 + 1] - bg[1]), Math.abs(data[i * 4 + 2] - bg[2]));
    if (d > tol && data[i * 4 + 3] > 10) m[i] = 1;
  }
  return m;
}

function maskBox(m, W, H) {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Compare the model's silhouette with a reference image (side view on a plain background).
 * The reference subject is scaled to the model's length and centered on it, so proportion
 * differences stay visible. Returns reference | model | overlay images and the silhouette IoU.
 */
window.studioCapture.referenceOverlay = async function referenceOverlay({ url, image, view = 'front', size = 768 }) {
  const { object } = await loadGLB(url);
  const H = Math.round(size / 2);
  const W = size;
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.add(object);
  const box = contentBox(object);
  applyLighting(renderer, scene, 'neutral', { size: box.getSize(new THREE.Vector3()).length() || 1 });
  const o = orthoCamera(box, view, W / H, 0.08);
  renderer.render(scene, o.cam);
  const model = await canvasFrom(canvas.toDataURL('image/png'), W, H);
  // Model mask from a flat white silhouette pass: shaded colors can match the background.
  const silhouette = new THREE.MeshBasicMaterial({ color: 0xffffff });
  scene.background = new THREE.Color(0x000000);
  scene.overrideMaterial = silhouette;
  renderer.render(scene, o.cam);
  scene.overrideMaterial = null;
  silhouette.dispose();
  scene.remove(object);
  const sil = await canvasFrom(canvas.toDataURL('image/png'), W, H);
  const mm = maskFrom(sil.ctx.getImageData(0, 0, W, H).data, W, H, [0, 0, 0], 100);
  const mb = maskBox(mm, W, H);
  // Reference: background from the corners, subject = pixels that differ.
  const ref = await loadImage(image);
  const rc = document.createElement('canvas');
  rc.width = ref.naturalWidth;
  rc.height = ref.naturalHeight;
  const rctx = rc.getContext('2d');
  rctx.drawImage(ref, 0, 0);
  const rd = rctx.getImageData(0, 0, rc.width, rc.height).data;
  const corner = (x, y) => {
    const i = (y * rc.width + x) * 4;
    return [rd[i], rd[i + 1], rd[i + 2]];
  };
  const cs = [corner(2, 2), corner(rc.width - 3, 2), corner(2, rc.height - 3), corner(rc.width - 3, rc.height - 3)];
  const rbg = [0, 1, 2].map((k) => Math.round(cs.reduce((s, c) => s + c[k], 0) / 4));
  const rm = maskFrom(rd, rc.width, rc.height, rbg, 28);
  const rb = maskBox(rm, rc.width, rc.height);
  if (!mb || !rb) throw new Error('reference overlay: could not find the model or the subject of the reference image (use a plain background)');
  // Uniform scale so the reference subject is as long as the model, centered on the model.
  const scale = mb.w / rb.w;
  const dw = rc.width * scale;
  const dh = rc.height * scale;
  const ox = mb.x0 - rb.x0 * scale;
  const oy = (mb.y0 + mb.y1) / 2 - ((rb.y0 + rb.y1) / 2) * scale;
  const refFrame = document.createElement('canvas');
  refFrame.width = W;
  refFrame.height = H;
  const fctx = refFrame.getContext('2d');
  fctx.fillStyle = `rgb(${rbg.join(',')})`;
  fctx.fillRect(0, 0, W, H);
  fctx.drawImage(rc, ox, oy, dw, dh);
  const fd = fctx.getImageData(0, 0, W, H).data;
  const fm = maskFrom(fd, W, H, rbg, 28);
  // Overlay: reference faded, model-only pixels red, reference-only pixels cyan.
  const ov = document.createElement('canvas');
  ov.width = W;
  ov.height = H;
  const octx = ov.getContext('2d');
  octx.globalAlpha = 0.45;
  octx.drawImage(refFrame, 0, 0);
  octx.globalAlpha = 1;
  const od = octx.getImageData(0, 0, W, H);
  let inter = 0;
  let union = 0;
  for (let i = 0; i < W * H; i++) {
    const a = mm[i];
    const b = fm[i];
    if (a || b) union++;
    if (a && b) inter++;
    if (a && !b) od.data.set([235, 60, 60, 255], i * 4);
    else if (b && !a) od.data.set([60, 200, 235, 255], i * 4);
    else if (a && b) {
      od.data[i * 4] = Math.round(od.data[i * 4] * 0.6 + 255 * 0.4);
      od.data[i * 4 + 1] = Math.round(od.data[i * 4 + 1] * 0.6 + 255 * 0.4);
      od.data[i * 4 + 2] = Math.round(od.data[i * 4 + 2] * 0.6 + 255 * 0.4);
    }
  }
  octx.putImageData(od, 0, 0);
  drawLabel(octx, 'red = model only · cyan = reference only', 8, H - 26, { size: 12 });
  const iou = union ? inter / union : 0;
  // One sheet: reference / model / overlay stacked.
  const header = 40;
  const sh = document.createElement('canvas');
  sh.width = W;
  sh.height = header + H * 3;
  const sctx = sh.getContext('2d');
  sctx.fillStyle = '#1d2024';
  sctx.fillRect(0, 0, sh.width, sh.height);
  sctx.fillStyle = '#ffc857';
  sctx.font = '700 17px system-ui, sans-serif';
  sctx.fillText(`Reference match (${view} view, orthographic): silhouette IoU ${(iou * 100).toFixed(1)}%`, 12, 26);
  [['reference', refFrame], ['model', model.cv], ['overlay', ov]].forEach(([label, c], i) => {
    sctx.drawImage(c, 0, header + i * H);
    drawLabel(sctx, label, 8, header + i * H + 8);
  });
  return { sheet: sh.toDataURL('image/png'), iou, width: W, height: H };
};

window.studioReady = true;
