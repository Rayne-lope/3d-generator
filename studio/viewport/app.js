// Live viewport. It never builds or renders source scenes: it loads the exported GLB of the
// selected asset/profile through a plain GLTFLoader (Preview = Export), and reloads it when
// the server reports a new build.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createRenderer, applyLighting, contentBox, frameCamera, forceSingleSided, makeGrid, makeHuman,
  makeDimensions, setViewMode, setOverlays, unitsPerMeter,
} from './scene-setup.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

const state = {
  assets: [],
  sets: [],
  profiles: [],
  slug: null,
  variant: null,
  profile: localStorage.getItem('studio.profile') || 'generic',
  lighting: 'neutral',
  viewMode: 'shaded',
  toggles: { wire: false, backfaces: false, grid: true, dims: true, human: false },
  report: null,
  gltf: null,
  units: 1,
  version: null,
  loadToken: 0,
};

// ------------------------------------------------------------------ three.js stage

const canvas = $('canvas');
const renderer = createRenderer(canvas);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
camera.position.set(2, 1.6, 2);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
let content = null;
let helpers = new THREE.Group();
scene.add(helpers);
applyLighting(renderer, scene, state.lighting);

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

function rebuildHelpers() {
  scene.remove(helpers);
  helpers = new THREE.Group();
  scene.add(helpers);
  if (!content) return;
  const box = contentBox(content);
  const u = state.units;
  if (state.toggles.grid) helpers.add(makeGrid(u, Math.max(10, Math.ceil((box.getSize(new THREE.Vector3()).length() / u) * 2))));
  if (state.toggles.dims) helpers.add(makeDimensions(box, u, { studs: state.profile === 'roblox' }));
  if (state.toggles.human) {
    const h = makeHuman(u);
    h.position.set(box.max.x + 0.45 * u, 0, (box.min.z + box.max.z) / 2);
    helpers.add(h);
  }
}

function applyViewSettings() {
  if (!content) return;
  setViewMode(content, state.viewMode);
  setOverlays(content, { wire: state.toggles.wire, backfaces: state.toggles.backfaces });
  rebuildHelpers();
}

function setView(name) {
  if (!content) return;
  const box = contentBox(content);
  const { center } = frameCamera(camera, box, name);
  controls.target.copy(center);
  controls.update();
}

const loader = new GLTFLoader();

async function loadGLB(url, { keepCamera = true } = {}) {
  const token = ++state.loadToken;
  const gltf = await loader.loadAsync(`${url}?t=${Date.now()}`);
  if (token !== state.loadToken) return;
  const prevUnits = state.units;
  if (content) {
    scene.remove(content);
    content.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }
  content = gltf.scene;
  forceSingleSided(content);
  state.gltf = gltf;
  state.units = unitsPerMeter(gltf);
  scene.add(content);
  const box = contentBox(content);
  applyLighting(renderer, scene, state.lighting, { size: box.getSize(new THREE.Vector3()).length() || 1 });
  applyViewSettings();
  if (!keepCamera || prevUnits !== state.units || !state.cameraSet) {
    setView('iso');
    state.cameraSet = true;
  }
  $('empty').classList.add('hidden');
  renderUVPanel();
}

// ------------------------------------------------------------------ data

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

function itemKey(slug = state.slug, variant = state.variant) {
  return variant ? `${slug}--${variant}` : slug;
}

async function refreshState() {
  const data = await api('/api/state');
  state.assets = data.assets;
  state.sets = data.sets;
  state.profiles = data.profiles;
  renderProfiles();
  renderAssetList();
}

function renderProfiles() {
  const sel = $('profile');
  if (sel.options.length !== state.profiles.length) {
    sel.innerHTML = state.profiles.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  }
  if (!state.profiles.some((p) => p.id === state.profile)) state.profile = 'generic';
  sel.value = state.profile;
}

function renderAssetList() {
  const filter = $('filter').value.trim().toLowerCase();
  const bySet = new Map();
  for (const a of state.assets) {
    if (filter && !`${a.slug} ${a.title} ${(a.style || []).join(' ')}`.toLowerCase().includes(filter)) continue;
    const key = a.set || '';
    if (!bySet.has(key)) bySet.set(key, []);
    bySet.get(key).push(a);
  }
  const html = [];
  const keys = [...bySet.keys()].sort((x, y) => (x === '' ? 1 : y === '' ? -1 : x.localeCompare(y)));
  for (const key of keys) {
    html.push(`<div class="group-title">${key ? `Set · ${esc(key)}` : 'Assets'}</div>`);
    for (const a of bySet.get(key)) {
      const p = a.profiles?.[state.profile] || a.profiles?.generic;
      const dot = !p ? '' : p.counts?.error ? 'err' : p.counts?.warning ? 'warn' : 'ok';
      const meta = [a.variants?.length ? `${a.variants.length} var` : '', p ? `${(p.triangles || 0).toLocaleString()}△` : 'not built'].filter(Boolean).join(' · ');
      html.push(`<div class="asset ${a.slug === state.slug ? 'on' : ''}" data-slug="${a.slug}"><span class="dot ${dot}"></span><span class="name" title="${esc(a.prompt || a.title)}">${esc(a.title || a.slug)}</span><span class="meta">${meta}</span></div>`);
    }
  }
  if (!state.assets.length) html.push('<div class="muted" style="padding:10px">No assets yet. Ask your agent to create one.</div>');
  $('assetList').innerHTML = html.join('');
}

async function selectAsset(slug, variant = null) {
  state.slug = slug;
  state.variant = variant;
  state.version = null;
  state.cameraSet = false;
  localStorage.setItem('studio.asset', slug);
  renderAssetList();
  const asset = state.assets.find((a) => a.slug === slug);
  $('title').textContent = asset ? `${asset.title}${variant ? ` — ${variant}` : ''}` : slug;
  renderVariantBar(asset);
  await showCurrent({ keepCamera: false });
  loadVersions();
}

function renderVariantBar(asset) {
  const bar = $('variantBar');
  if (!asset || !asset.variants?.length) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  bar.innerHTML = [null, ...asset.variants].map((v) => `<button data-variant="${v ?? ''}" class="${(v ?? null) === state.variant ? 'on' : ''}">${v ?? 'base'}</button>`).join('');
}

async function showCurrent({ keepCamera = true } = {}) {
  if (!state.slug) return;
  hideBanner();
  setStatus(`Loading ${itemKey()} [${state.profile}]…`);
  let { report, error } = await api(`/api/report?slug=${state.slug}${state.variant ? `&variant=${state.variant}` : ''}&profile=${state.profile}`).catch(() => ({}));
  if (!report && !error) {
    setStatus(`Building ${itemKey()} [${state.profile}]…`);
    const result = await api('/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: state.slug, variant: state.variant, profile: state.profile }) });
    ({ report, error } = await api(`/api/report?slug=${state.slug}${state.variant ? `&variant=${state.variant}` : ''}&profile=${state.profile}`).catch(() => ({})));
    if (result.error) error = result.error;
  }
  state.report = report || null;
  renderReport();
  if (error) showBanner(`Build failed:\n${error}`, true);
  if (report) {
    await loadGLB(`/files/preview/${itemKey()}/${state.profile}.glb`, { keepCamera });
    setStatus(`${itemKey()} [${state.profile}] · built ${new Date(report.builtAt).toLocaleTimeString()} · ${report.file.path}`);
  }
}

// ------------------------------------------------------------------ panels

function fmtDims(r) {
  const m = r.dimensions.meters.map((v) => (v < 1 ? `${(v * 100).toFixed(1)} cm` : `${v.toFixed(2)} m`)).join(' × ');
  return r.profile.id === 'roblox' ? `${m}<br><span class="muted">${r.dimensions.units.map((v) => v.toFixed(1)).join(' × ')} studs in file</span>` : m;
}

function renderReport() {
  const r = state.report;
  const el = $('tab-report');
  if (!r) {
    el.innerHTML = '<p class="muted">No report yet.</p>';
    $('issueCount').textContent = '';
    $('tab-issues').innerHTML = '';
    return;
  }
  const notes = r.notes.map((n) => `<div class="note">• ${esc(n.message)}</div>`).join('');
  el.innerHTML = `
    <div class="kv">
      <div>Status</div><div>${r.ok ? '<span style="color:var(--ok)">passes preflight</span>' : `<span style="color:var(--err)">${r.counts.error} error(s) block export</span>`} · ${r.counts.warning} warnings</div>
      <div>Profile</div><div>${esc(r.profile.label)}</div>
      <div>Size</div><div>${fmtDims(r)}</div>
      <div>Triangles</div><div>${r.triangles.total.toLocaleString()}${r.triangles.budget ? ` / ${r.triangles.budget.toLocaleString()} budget` : ''}</div>
      <div>Meshes</div><div>${r.meshCount}</div>
      <div>File</div><div>${(r.file.bytes / 1024).toFixed(1)} KB</div>
      ${r.prompt ? `<div>Prompt</div><div>${esc(r.prompt)}</div>` : ''}
      ${r.interpretation ? `<div>Reading</div><div>${esc(r.interpretation)}</div>` : ''}
    </div>
    <h3>Meshes</h3>
    <table><tr><th>Node</th><th class="num">Tris</th><th>Materials</th></tr>
      ${r.triangles.perMesh.map((m) => `<tr><td>${esc(m.node)}</td><td class="num">${m.triangles.toLocaleString()}</td><td>${esc(m.materials.join(', '))}</td></tr>`).join('')}
    </table>
    <h3>Materials</h3>
    <table><tr><th>Name</th><th class="num">Metal</th><th class="num">Rough</th><th>Alpha</th></tr>
      ${r.materials.map((m) => `<tr><td><span class="swatch" style="background:${m.baseColor}"></span>${esc(m.name)}</td><td class="num">${m.metallic}</td><td class="num">${m.roughness}</td><td>${m.alphaMode}</td></tr>`).join('')}
    </table>
    ${r.palette?.length ? `<h3>Palette swatches</h3>${r.palette.map((p) => p.swatches.map((s) => `<span class="swatch" title="${esc(s.materials.join(', '))}" style="background:rgb(${s.color.slice(0, 3).join(',')})"></span>`).join('')).join('')}` : ''}
    ${r.textures.length ? `<h3>Textures</h3><table><tr><th>Name</th><th>Size</th><th class="num">px/m</th><th class="num">Pad</th></tr>${r.textures.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.width}×${t.height}</td><td class="num">${t.texelDensity ?? '—'}</td><td class="num">${t.minPaddingPx ?? '—'}</td></tr>`).join('')}</table>` : ''}
    ${notes ? `<h3>Engine conversions</h3>${notes}` : ''}
    ${r.importHints?.length ? `<h3>Import</h3>${r.importHints.map((h) => `<div class="note">• ${esc(h)}</div>`).join('')}` : ''}
  `;
  const shown = r.issues;
  const pill = $('issueCount');
  pill.textContent = r.counts.error || r.counts.warning || '';
  pill.className = `pill ${r.counts.error ? '' : 'warn'}`;
  $('tab-issues').innerHTML = shown.length
    ? shown.map((i) => `<div class="issue ${i.severity}"><div>${esc(i.message)}</div><div class="id">${i.severity} · ${i.id}</div>${i.hint ? `<div class="hint">Fix: ${esc(i.hint)}</div>` : ''}</div>`).join('')
    : '<p class="muted">No issues. Ready to export.</p>';
  renderUVSelect();
}

function renderUVSelect() {
  const r = state.report;
  const sel = $('uvTexture');
  const textures = r?.textures || [];
  sel.innerHTML = textures.length ? textures.map((t, i) => `<option value="${i}">${esc(t.name)} (${t.width}×${t.height})</option>`).join('') : '<option>No textures</option>';
}

function findLoadedTexture(name) {
  let found = null;
  content?.traverse((o) => {
    if (!o.isMesh || found) return;
    const m = o.userData.__orig || o.material;
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
      if (m[key] && m[key].name === name) found = m[key];
    }
  });
  return found;
}

function renderUVPanel() {
  const r = state.report;
  const cv = $('uvCanvas');
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const info = $('uvInfo');
  if (!r || !r.textures.length || !content) {
    info.textContent = 'This asset uses no textures.';
    return;
  }
  const t = r.textures[Number($('uvTexture').value) || 0];
  if (!t) return;
  const tex = findLoadedTexture(t.name);
  const S = cv.width;
  if (tex?.image) ctx.drawImage(tex.image, 0, 0, S, S);
  ctx.strokeStyle = 'rgba(80, 220, 255, 0.55)';
  ctx.lineWidth = 0.6;
  content.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.userData.__orig || o.material;
    const uses = ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'aoMap'].some((k) => m[k] && m[k].name === t.name);
    if (!uses || !o.geometry.attributes.uv) return;
    const uv = o.geometry.attributes.uv;
    const idx = o.geometry.index ? o.geometry.index.array : null;
    const count = idx ? idx.length : uv.count;
    ctx.beginPath();
    for (let i = 0; i < count; i += 3) {
      const a = idx ? idx[i] : i;
      const b = idx ? idx[i + 1] : i + 1;
      const c = idx ? idx[i + 2] : i + 2;
      ctx.moveTo(uv.getX(a) * S, uv.getY(a) * S);
      ctx.lineTo(uv.getX(b) * S, uv.getY(b) * S);
      ctx.lineTo(uv.getX(c) * S, uv.getY(c) * S);
      ctx.closePath();
    }
    ctx.stroke();
  });
  const viol = t.paddingViolations || [];
  ctx.strokeStyle = '#ff2d55';
  ctx.lineWidth = 2;
  for (const v of viol) {
    ctx.beginPath();
    ctx.arc((v.x / t.width) * S, (v.y / t.height) * S, 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  const parts = [`${t.width}×${t.height}`, t.layout || ''];
  if (t.texelDensity) parts.push(`${t.texelDensity} px/m`);
  if (t.minPaddingPx !== undefined && t.minPaddingPx !== null) parts.push(`min padding ${t.minPaddingPx}px (needs ${t.requiredPaddingPx}px)`);
  if (viol.length) parts.push(`<span style="color:var(--err)">${viol.length} padding violation(s) circled</span>`);
  info.innerHTML = parts.filter(Boolean).join(' · ');
}

async function loadVersions() {
  const el = $('tab-versions');
  if (!state.slug) return;
  const data = await api(`/api/history?slug=${state.slug}`).catch(() => ({ versions: [] }));
  const versions = data.versions || [];
  if (!versions.length) {
    el.innerHTML = `<p class="muted">No saved versions yet.</p><p class="muted">Your agent saves one after each request:<br><code>node studio save ${esc(state.slug)} -m "…"</code></p>`;
    return;
  }
  el.innerHTML = `
    <p class="muted">Click to preview a version (read-only). Restore with the command shown.</p>
    <div class="version ${state.version === null ? 'on' : ''}" data-version=""><div class="muted" style="display:flex;align-items:center;justify-content:center">live</div><div><div class="v">Working copy</div><div class="muted">latest build</div></div></div>
    ${versions.slice().reverse().map((v) => `
      <div class="version ${state.version === v.id ? 'on' : ''}" data-version="${v.id}">
        <img src="/files/history/${state.slug}/${v.id}/sheet.png" alt="" onerror="this.style.visibility='hidden'">
        <div><div class="v">${v.id}${v.pinned ? ' 📌' : ''}</div><div>${esc(v.note || '')}</div>
        <div class="muted">${new Date(v.createdAt).toLocaleString()} · ${v.triangles?.toLocaleString() ?? '?'}△</div>
        <code>node studio revert ${esc(state.slug)} ${v.id}</code></div>
      </div>`).join('')}
  `;
}

async function previewVersion(id) {
  state.version = id || null;
  loadVersions();
  if (!id) {
    hideBanner();
    await showCurrent();
    return;
  }
  showBanner(`Previewing saved version ${id} (read-only). Restore: node studio revert ${state.slug} ${id}`);
  await loadGLB(`/files/history/${state.slug}/${id}/generic.glb`);
}

// ------------------------------------------------------------------ UI helpers

function setStatus(text) {
  $('status').textContent = text;
}

function showBanner(text, error = false) {
  const b = $('banner');
  b.textContent = text;
  b.classList.toggle('error', error);
  b.classList.remove('hidden');
}

function hideBanner() {
  $('banner').classList.add('hidden');
}

function lightingBanner() {
  if (state.lighting === 'showcase') showBanner('Showcase lighting: reflections and tone mapping are viewport-only. Use Neutral to judge parity with engines.');
  else if (!state.version) hideBanner();
}

// ------------------------------------------------------------------ events

$('assetList').addEventListener('click', (e) => {
  const el = e.target.closest('.asset');
  if (el) selectAsset(el.dataset.slug);
});
$('filter').addEventListener('input', renderAssetList);
$('variantBar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const v = b.dataset.variant || null;
  state.variant = v;
  renderVariantBar(state.assets.find((a) => a.slug === state.slug));
  $('title').textContent = `${state.assets.find((a) => a.slug === state.slug)?.title || state.slug}${v ? ` — ${v}` : ''}`;
  showCurrent();
});
$('profile').addEventListener('change', (e) => {
  state.profile = e.target.value;
  localStorage.setItem('studio.profile', state.profile);
  renderAssetList();
  showCurrent({ keepCamera: false });
});
$('lighting').addEventListener('change', (e) => {
  state.lighting = e.target.value;
  if (content) applyLighting(renderer, scene, state.lighting, { size: contentBox(content).getSize(new THREE.Vector3()).length() || 1 });
  lightingBanner();
});
$('viewMode').addEventListener('change', (e) => {
  state.viewMode = e.target.value;
  applyViewSettings();
});
document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.toggle;
  state.toggles[k] = !state.toggles[k];
  b.classList.toggle('on', state.toggles[k]);
  applyViewSettings();
}));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === `tab-${b.dataset.tab}`));
  if (b.dataset.tab === 'uv') renderUVPanel();
  if (b.dataset.tab === 'versions') loadVersions();
}));
$('uvTexture').addEventListener('change', renderUVPanel);
$('tab-versions').addEventListener('click', (e) => {
  const el = e.target.closest('.version');
  if (el) previewVersion(el.dataset.version);
});
$('shot').addEventListener('click', () => {
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${itemKey() || 'viewport'}-${state.profile}.png`;
  a.click();
});
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const map = { w: 'wire', b: 'backfaces', g: 'grid', d: 'dims', h: 'human' };
  if (map[e.key]) document.querySelector(`[data-toggle="${map[e.key]}"]`).click();
  if (e.key === 'f') setView('iso');
});

// Live updates from the server.
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', () => setStatus('Connected. Waiting for builds…'));
  es.addEventListener('build-start', (e) => {
    const d = JSON.parse(e.data);
    if (d.slug === state.slug) setStatus(`Rebuilding ${d.slug} [${d.profile}]…`);
  });
  es.addEventListener('built', async (e) => {
    const d = JSON.parse(e.data);
    await refreshState();
    if (d.slug === state.slug && (d.variant || null) === state.variant && d.profile === state.profile && !state.version) {
      if (d.error) {
        showBanner(`Build failed:\n${d.error}`, true);
        setStatus(`Build failed for ${d.slug}`);
      } else {
        await showCurrent();
      }
    }
  });
  es.onerror = () => setStatus('Disconnected from studio server — is `node studio dev` running?');
}

await refreshState();
connect();
const last = localStorage.getItem('studio.asset');
if (last && state.assets.some((a) => a.slug === last)) selectAsset(last);
