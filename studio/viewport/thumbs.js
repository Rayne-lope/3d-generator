// Library thumbnails. Each one is rendered once in the browser from the asset's exported
// generic GLB (the same file the viewport shows) and cached on the server by GLB hash, so
// the next visit loads a plain PNG.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRenderer, applyLighting, contentBox, frameCamera, forceSingleSided } from './scene-setup.js';

const SIZE = 256;

export class ThumbnailQueue {
  constructor() {
    this.pending = [];
    this.known = new Map(); // item → url
    this.requested = new Set();
    this.running = false;
    this.loader = new GLTFLoader();
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.observer.unobserve(entry.target);
        this.request(entry.target);
      }
    }, { rootMargin: '200px' });
  }

  /** Markup for a thumbnail slot. Cached ones load directly; the rest render when scrolled into view. */
  html(item, { thumb = null, glbHash = null } = {}) {
    const url = thumb || this.known.get(`${item}|${glbHash}`);
    if (url) return `<img class="thumb" src="${url}" alt="" loading="lazy">`;
    if (!glbHash) return '<span class="thumb thumb-empty" title="Not built yet"></span>';
    return `<img class="thumb thumb-pending" alt="" data-thumb-item="${item}" data-thumb-hash="${glbHash}">`;
  }

  /** Watch the pending slots inside `root` (call after rendering a list). */
  observe(root) {
    for (const img of root.querySelectorAll('img[data-thumb-item]')) this.observer.observe(img);
  }

  request(img) {
    const item = img.dataset.thumbItem;
    const hash = img.dataset.thumbHash;
    const key = `${item}|${hash}`;
    const done = (url) => {
      // The list may have been re-rendered meanwhile: update every slot waiting for this item.
      for (const el of document.querySelectorAll(`img[data-thumb-item="${CSS.escape(item)}"][data-thumb-hash="${hash}"]`)) {
        el.src = url;
        el.classList.remove('thumb-pending');
        delete el.dataset.thumbItem;
      }
    };
    if (this.known.has(key)) return done(this.known.get(key));
    if (this.requested.has(key)) return;
    this.requested.add(key);
    this.pending.push({ item, hash, key, done });
    this.pump();
  }

  ensureStage() {
    if (this.renderer) return;
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.renderer = createRenderer(this.canvas, { preserveDrawingBuffer: true });
    this.renderer.setSize(SIZE, SIZE, false);
    this.renderer.setClearColor('#2c3137', 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    applyLighting(this.renderer, this.scene, 'neutral');
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    while (this.pending.length) {
      const job = this.pending.shift();
      try {
        const url = await this.render(job);
        this.known.set(job.key, url);
        job.done(url);
      } catch {
        this.requested.delete(job.key);
      }
      // Yield so a long library never blocks interaction.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.running = false;
  }

  async render({ item, hash }) {
    this.ensureStage();
    const gltf = await this.loader.loadAsync(`/files/preview/${item}/generic.glb?h=${hash.slice(0, 12)}`);
    const root = gltf.scene;
    forceSingleSided(root);
    this.scene.add(root);
    const box = contentBox(root);
    frameCamera(this.camera, box, 'iso', { fit: 1.12 });
    this.renderer.render(this.scene, this.camera);
    const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
    this.scene.remove(root);
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) m[key]?.dispose();
        m.dispose();
      }
    });
    if (!blob) throw new Error('thumbnail render failed');
    try {
      const res = await fetch(`/api/thumb?item=${encodeURIComponent(item)}&hash=${hash}`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: blob });
      const data = await res.json();
      if (res.ok && data.thumb) return data.thumb;
    } catch {
      // Not cached on the server: the local image still works for this session.
    }
    return URL.createObjectURL(blob);
  }
}
