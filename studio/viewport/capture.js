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

async function loadSource(slug, variant) {
  const kit = await import('/studio/kit/index.js');
  const mod = await import(`/assets/${slug}/asset.js?t=${Date.now()}`);
  const { root } = kit.runAsset(mod.default, { variant: variant || null });
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

  async renderSource({ slug, variant = null, views, size = 512, lighting = 'neutral', frameBox = null }) {
    const { object } = await loadSource(slug, variant);
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

window.studioReady = true;
