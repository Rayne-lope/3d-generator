// Live viewport. It never builds or renders source scenes: it loads the exported GLB of the
// selected asset/profile through a plain GLTFLoader (Preview = Export), and reloads it when
// the server reports a new build.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EditorController } from './editor.js';
import { PartViewportController } from './parts.js';
import { SceneComposer } from './composer.js';
import { SceneUI } from './scene-ui.js';
import { ThumbnailQueue } from './thumbs.js';
import {
  createRenderer, applyLighting, contentBox, frameCamera, forceSingleSided, makeGrid, makeScaleRef,
  makeDimensions, makeMarkers, setViewMode, setOverlays, unitsPerMeter, VIEWS, SCALE_REFS,
} from './scene-setup.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

const state = {
  assets: [],
  sets: [],
  profiles: [],
  slug: null,
  variant: null,
  skin: null,
  profile: localStorage.getItem('studio.profile') || 'generic',
  lighting: 'neutral',
  viewMode: 'shaded',
  toggles: { wire: false, backfaces: false, grid: true, dims: true, colliders: true, attach: true },
  scaleRef: 'off',
  mode: 'asset', // 'asset' (one asset) | 'scene' (the composer)
  sceneName: null,
  report: null,
  gltf: null,
  units: 1,
  version: null,
  loadToken: 0,
  viewToken: 0,
  sidebar: 'assets',
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
let partController = null;
let composer = null;
let helpers = new THREE.Group();
scene.add(helpers);
applyLighting(renderer, scene, state.lighting);

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
  composer?.resize();
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  partController?.update();
  composer?.update();
  renderer.render(scene, composer?.camera || camera);
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
  // Markers come from the report of the GLB on screen (same units), so they also show for
  // profiles whose file does not contain them (Roblox).
  const r = state.report;
  if (r && ((state.toggles.colliders && r.colliders?.length) || (state.toggles.attach && r.attachments?.length))) {
    helpers.add(makeMarkers(r, { colliders: state.toggles.colliders, attachments: state.toggles.attach }));
  }
  const ref = makeScaleRef(state.scaleRef, u);
  if (ref) {
    ref.name = '__human';
    // Roblox rigs stand in a T-pose (4 studs wide), so they need more room than the mannequin.
    ref.position.set(box.max.x + (state.scaleRef === 'human' ? 0.45 : 0.8) * u, 0, (box.min.z + box.max.z) / 2);
    helpers.add(ref);
  }
}

function applyViewSettings() {
  if (!content) return;
  setViewMode(content, state.viewMode);
  setOverlays(content, { wire: state.toggles.wire, backfaces: state.toggles.backfaces });
  rebuildHelpers();
}

function setView(name) {
  if (state.mode === 'scene') { composer.setView(name); return; }
  if (!content) return;
  const box = contentBox(content);
  const { center } = frameCamera(camera, box, name);
  controls.target.copy(center);
  controls.update();
}

const loader = new GLTFLoader();

async function loadGLB(url, { keepCamera = true, ready = false, isCurrent = () => true } = {}) {
  const token = ++state.loadToken;
  const gltf = await loader.loadAsync(`${url}?t=${Date.now()}`);
  if (token !== state.loadToken || !isCurrent()) return false;
  const prevUnits = state.units;
  partController?.cancel();
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
  const previouslySelected = partController?.selected;
  const selectionBelongedToLook = previouslySelected && editor.selectedPartId === previouslySelected;
  partController?.setContext({ content, parts: (state.version ? state.report?.parts : editor.snapshot?.parts || []).map((part) => ({ ...part, value: editor.snapshot?.partTransforms?.effective?.[part.id] })), units: state.units,
    readOnly: editor.readOnly || !!state.version || !ready });
  if (selectionBelongedToLook && !partController?.selected) editor.showAlert(`Selected part '${previouslySelected}' no longer exists in this exported look. Selection was cleared.`);
  renderPartsList();
  const box = contentBox(content);
  applyLighting(renderer, scene, state.lighting, { size: box.getSize(new THREE.Vector3()).length() || 1 });
  applyViewSettings();
  if (!keepCamera || prevUnits !== state.units || !state.cameraSet) {
    setView('iso');
    if (state.scaleRef !== 'off') frameWithHelpers();
    state.cameraSet = true;
  }
  $('empty').classList.add('hidden');
  renderUVPanel();
  return true;
}

// ------------------------------------------------------------------ data

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

function itemKey(slug = state.slug, variant = state.variant, skin = state.skin) {
  return `${slug}${variant ? `--${variant}` : ''}${skin ? `@${skin}` : ''}`;
}

function lookQuery() {
  return `slug=${state.slug}${state.variant ? `&variant=${state.variant}` : ''}${state.skin ? `&skin=${state.skin}` : ''}&profile=${state.profile}`;
}

function titleText(asset) {
  return `${asset?.title || state.slug}${state.variant ? ` — ${state.variant}` : ''}${state.skin ? ` · ${state.skin}` : ''}`;
}

async function refreshState() {
  const data = await api('/api/state');
  state.assets = data.assets;
  state.sets = data.sets;
  state.profiles = data.profiles;
  // A server started before the studio's code changed (or before this page's version) cannot
  // tell which previews are current: say so instead of leaving everything "out of date".
  const notice = $('serverNotice');
  const outdated = data.codeChanged === true || data.codeChanged === undefined;
  notice.classList.toggle('hidden', !outdated);
  if (outdated) notice.innerHTML = 'The studio was updated: stop this server (Ctrl+C) and run <code>node studio dev</code> again. Until then previews stay “out of date” and Export is off.';
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
      const meta = [a.variants?.length ? `${a.variants.length} var` : '', a.skins?.length ? `${a.skins.length} skin${a.skins.length === 1 ? '' : 's'}` : '', p ? `${(p.triangles || 0).toLocaleString()}△` : 'not built'].filter(Boolean).join(' · ');
      html.push(`<div class="asset ${a.slug === state.slug ? 'on' : ''}" data-slug="${a.slug}">${thumbs.html(a.slug, a)}<span class="dot ${dot}"></span><span class="name" title="${esc(a.prompt || a.title)}">${esc(a.title || a.slug)}</span><span class="meta">${meta}</span></div>`);
    }
  }
  if (!state.assets.length) html.push('<div class="muted" style="padding:10px">No assets yet. Ask your agent to create one.</div>');
  $('assetList').innerHTML = html.join('');
  thumbs.observe($('assetList'));
}

function setSidebarTab(name) {
  state.sidebar = ['parts', 'scenes'].includes(name) ? name : 'assets';
  $('assetList').classList.toggle('hidden', state.sidebar !== 'assets');
  $('partList').classList.toggle('hidden', state.sidebar !== 'parts');
  $('sceneSide').classList.toggle('hidden', state.sidebar !== 'scenes');
  $('filter').classList.toggle('hidden', state.sidebar === 'parts');
  for (const [key, node] of [['assets', $('sideAssets')], ['parts', $('sideParts')], ['scenes', $('sideScenes')]]) {
    node.classList.toggle('on', state.sidebar === key);
    node.setAttribute('aria-selected', String(state.sidebar === key));
  }
  $('sideFoot').textContent = state.sidebar === 'scenes'
    ? 'Assets are placed at their real size. Every instance is the exported GLB of that asset.'
    : 'Select a part to inspect its transform. The viewport always loads the exported GLB.';
  localStorage.setItem('studio.sidebar', state.sidebar);
  if (state.sidebar === 'scenes') enterSceneMode();
  else exitSceneMode();
}

// ------------------------------------------------------------------ scene mode

const EMPTY_HTML = $('empty').innerHTML;

function unitsOfProfile(id = state.profile) {
  return state.profiles.find((p) => p.id === id)?.units?.perMeter || 1;
}

function removeAssetContent() {
  partController?.cancel();
  partController?.setContext({ content: null, parts: [], units: 1, readOnly: true });
  if (content) {
    scene.remove(content);
    content.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    content = null;
  }
  scene.remove(helpers);
  helpers = new THREE.Group();
  scene.add(helpers);
}

function enterSceneMode() {
  if (state.mode === 'scene') return;
  exitHistory();
  ++state.viewToken;
  ++state.loadToken;
  state.mode = 'scene';
  document.body.classList.add('mode-scene');
  removeAssetContent();
  hideBanner();
  $('partTools').classList.add('hidden');
  $('variantBar').classList.add('hidden');
  $('skinBar').classList.add('hidden');
  $('sceneTools').classList.remove('hidden');
  selectTab('scene');
  sceneUI.refreshScenes();
  sceneUI.refreshLibrary();
  const last = state.sceneName || localStorage.getItem('studio.scene');
  openScene(last || null);
}

function exitSceneMode() {
  if (state.mode !== 'scene') return;
  state.mode = 'asset';
  composer.exit();
  document.body.classList.remove('mode-scene');
  $('sceneTools').classList.add('hidden');
  $('empty').innerHTML = EMPTY_HTML;
  $('empty').classList.toggle('hidden', !!state.slug);
  if (state.slug) selectAsset(state.slug, state.variant);
  else {
    $('title').textContent = 'No asset selected';
    selectTab('report');
    setStatus('Pick an asset on the left.');
  }
}

async function openScene(name) {
  if (state.mode !== 'scene') return;
  state.sceneName = name;
  if (!name) {
    composer.exit();
    $('title').textContent = 'No scene selected';
    $('empty').classList.remove('hidden');
    $('empty').innerHTML = '<h2>Scene composer</h2><p>Choose a scene on the left or create one, then place assets from the library.</p>';
    setStatus('Choose or create a scene.');
    sceneUI.render();
    return;
  }
  localStorage.setItem('studio.scene', name);
  $('empty').classList.add('hidden');
  $('title').textContent = `Scene — ${name}`;
  await composer.enter(name, state.profile, unitsOfProfile());
  if (state.mode !== 'scene' || state.sceneName !== name) return;
  if (composer.doc) $('title').textContent = `Scene — ${composer.doc.title}`;
  applyLighting(renderer, scene, state.lighting, { size: composer.contentBox().getSize(new THREE.Vector3()).length() || 1 });
  sceneUI.render();
}

function renderPartsList() {
  const node = $('partList');
  const parts = state.version ? state.report?.parts || [] : editor.snapshot?.parts || [];
  const selected = partController?.selected;
  const rawNodes = partController?.rawNodes || [];
  if (!state.slug) node.innerHTML = '<p class="muted">Choose an asset first.</p>';
  else if (rawNodes.length) {
    const byId = new Map(parts.map((part) => [part.id, part]));
    node.innerHTML = `<div class="group-title">Exported GLB hierarchy</div>${rawNodes.map((entry) => {
      const part = byId.get(entry.partId);
      const active = entry.partId && selected === entry.partId || partController?.selectedRaw?.index === entry.index;
      const tag = part?.editable && !state.version && !state.skin ? 'Editable part' : entry.name === 'body' ? 'Merged · read-only' : entry.parent === null ? 'Asset root · read-only' : entry.hasMesh ? 'Mesh · read-only' : 'Group · read-only';
      const label = part?.label || (entry.name === 'body' ? 'Body (merged)' : entry.parent === null ? `Asset root · ${entry.name}` : entry.name);
      return `<button type="button" role="treeitem" aria-selected="${!!active}" aria-level="${entry.depth + 1}" class="part-tree-row ${active ? 'selected' : ''} ${part?.editable ? '' : 'readonly'}" style="padding-left:${8 + Math.min(entry.depth, 9) * 14}px" ${part ? `data-part-id="${esc(part.id)}"` : `data-node-index="${entry.index}"`}><span>${entry.hasMesh ? '◇' : '▣'}</span><span>${esc(label)}</span><span class="part-tag">${tag}</span></button>`;
    }).join('')}`;
  } else if (!parts.length) node.innerHTML = '<p class="muted">No editable separate parts in this asset yet. Load its exported GLB to inspect the hierarchy.</p>';
  else {
    const children = (parentId, depth = 1) => parts.filter((part) => part.parentPartId === parentId).map((part) => `
      <button type="button" class="part-tree-row ${part.id === selected ? 'selected' : ''} ${part.editable ? '' : 'readonly'}" role="treeitem" aria-selected="${part.id === selected}" data-part-id="${esc(part.id)}" style="padding-left:${8 + depth * 14}px">
        <span>◇</span><span>${esc(part.label)}</span><span class="part-tag">${part.editable ? 'Move · Rotate · Scale' : 'Read only'}</span>
      </button>${children(part.id, depth + 1)}`).join('');
    node.innerHTML = `<div class="group-title">Exported hierarchy</div><div class="part-tree-row readonly" style="padding-left:8px">▣ ${esc(state.slug)}</div><div class="part-tree-row readonly" style="padding-left:22px">▣ body · merged</div>${children(null)}`;
  }
  $('partTools').classList.toggle('hidden', !parts.length || !!state.version || !!state.skin);
  $('partDraftBadge').classList.toggle('hidden', !partController?.pendingDraft);
  $('partDraftBadge').textContent = partController?.pendingDraft && editor.mutationBusy ? 'Saving part draft…' : 'Draft not saved · Retry or Discard';
  for (const button of document.querySelectorAll('[data-part-mode]')) {
    const part = parts.find((item) => item.id === selected);
    const mode = button.dataset.partMode;
    const capability = mode === 'translate' ? 'move' : mode === 'rotate' ? 'rotate' : mode === 'scale' ? 'scale' : null;
    button.disabled = !!(partController?.locked && partController?.pendingDraft) || mode !== 'select' && (editor.readOnly || partController?.locked || !part?.editable || !part?.transform?.[capability]);
  }
}

async function selectAsset(slug, variant = null) {
  partController?.cancel();
  exitHistory();
  const selectionToken = ++state.viewToken;
  ++state.loadToken;
  state.slug = slug;
  state.variant = variant;
  state.skin = null;
  state.version = null;
  state.cameraSet = false;
  localStorage.setItem('studio.asset', slug);
  renderAssetList();
  const asset = state.assets.find((a) => a.slug === slug);
  $('title').textContent = asset ? titleText(asset) : slug;
  renderVariantBar(asset);
  await editor.setContext({ slug, variant, skin: null, profile: state.profile, version: null });
  if (selectionToken !== state.viewToken || state.slug !== slug) return;
  partController?.setContext({ content: null, parts: (editor.snapshot?.parts || []).map((part) => ({ ...part, value: editor.snapshot?.partTransforms?.effective?.[part.id] })), units: 1, readOnly: true });
  renderPartsList();
  selectTab(editor.supported ? 'edit' : 'report');
  await showCurrent({ keepCamera: false });
  loadVersions();
}

function renderVariantBar(asset) {
  const bar = $('variantBar');
  if (!asset || !asset.variants?.length) bar.classList.add('hidden');
  else {
    bar.classList.remove('hidden');
    bar.innerHTML = `<span class="bar-label">Variant</span>${[null, ...asset.variants].map((v) => `<button data-variant="${v ?? ''}" class="${(v ?? null) === state.variant ? 'on' : ''}">${v ?? 'base'}</button>`).join('')}`;
  }
  // Skins: same mesh, different textures (every skin passes the skin lock against 'default').
  const skins = $('skinBar');
  if (!asset || !asset.skins?.length) skins.classList.add('hidden');
  else {
    skins.classList.remove('hidden');
    skins.innerHTML = `<span class="bar-label">Skin</span>${[null, ...asset.skins].map((s) => `<button data-skin="${s ?? ''}" class="${(s ?? null) === state.skin ? 'on' : ''}">${s ?? 'default'}</button>`).join('')}`;
  }
}

async function showCurrent({ keepCamera = true, forceBuild = false, allowBuild = true } = {}) {
  if (!state.slug || state.version || state.mode === 'scene') return;
  const previousPreviewError = editor.previewError;
  const token = ++state.viewToken;
  const look = { slug: state.slug, variant: state.variant, skin: state.skin, profile: state.profile };
  const stillCurrent = () => token === state.viewToken && !state.version && look.slug === state.slug && look.variant === state.variant && look.skin === state.skin && look.profile === state.profile;
  hideBanner();
  editor.markPreviewPending();
  setStatus(`Loading ${itemKey()} [${state.profile}]…`);
  const query = new URLSearchParams({ slug: look.slug, profile: look.profile });
  if (look.variant) query.set('variant', look.variant);
  if (look.skin) query.set('skin', look.skin);
  let { report, error } = await api(`/api/report?${query}`).catch(() => ({}));
  if (!stillCurrent()) return;
  const needsBuild = forceBuild || (!report && !error) || editor.snapshot?.preview?.current === false;
  if (allowBuild && needsBuild) {
    setStatus(`Building ${itemKey()} [${state.profile}]…`);
    try {
      const result = await api('/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(look) });
      if (!stillCurrent()) return;
      ({ report, error } = await api(`/api/report?${query}`).catch(() => ({})));
      if (result.error) error = result.error;
    } catch (buildError) { error = buildError.message; }
  }
  if (!stillCurrent()) return;
  await editor.refresh();
  if (!stillCurrent()) return;
  let current = editor.snapshot?.preview?.current === true && report?.hashes?.source === editor.snapshot.preview.sourceHash;
  if (!current && !error && allowBuild && !needsBuild) {
    setStatus(`Building ${itemKey()} [${state.profile}]…`);
    const result = await api('/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(look) }).catch((buildError) => ({ error: buildError.message }));
    if (!stillCurrent()) return;
    ({ report, error } = await api(`/api/report?${query}`).catch(() => ({})));
    if (result.error) error = result.error;
    await editor.refresh();
    if (!stillCurrent()) return;
    current = editor.snapshot?.preview?.current === true && report?.hashes?.source === editor.snapshot.preview.sourceHash;
  }
  state.report = report || null;
  editor.setReport(null, { error: error || null, pending: !error });
  renderReport();
  if (error) {
    showBanner(`Build failed:\n${error}`, true);
    editor.showAlert(`Build failed: ${error}`, { 'Retry build': () => showCurrent({ forceBuild: true }), ...(editor.stack.undo.length ? { 'Undo edit': () => editor.undo() } : {}) });
  }
  else lightingBanner();
  if (report) {
    try {
      const loaded = await loadGLB(`/files/preview/${itemKey()}/${look.profile}.glb`, { keepCamera, ready: current && !error, isCurrent: stillCurrent });
      if (stillCurrent() && loaded) {
        editor.setLoadedSourceHash(current && !error ? report.hashes?.source : null);
        editor.setReport(report, { error: error || null, pending: !current && !error });
        if (current && !error && previousPreviewError) editor.clearAlert();
        renderReport();
        setStatus(`${itemKey()} [${look.profile}] · built ${new Date(report.builtAt).toLocaleTimeString()} · ${report.file.path}`);
      }
    } catch (loadError) {
      if (stillCurrent()) {
        editor.setReport(report, { error: `Could not load GLB: ${loadError.message}` });
        showBanner(`Preview failed: ${loadError.message}`, true);
        editor.showAlert(`Preview failed: ${loadError.message}`, { 'Retry build': () => showCurrent({ forceBuild: true }), ...(editor.stack.undo.length ? { 'Undo edit': () => editor.undo() } : {}) });
      }
    }
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
  const reportStatus = state.version ? '<span class="muted">Saved version · Generic report</span>'
    : !editor.fresh ? '<span style="color:var(--warn)">Preview out of date</span>'
      : r.ok ? '<span style="color:var(--ok)">passes preflight</span>'
        : `<span style="color:var(--err)">${r.counts.error} error(s) block export</span>`;
  el.innerHTML = `
    <div class="kv">
      <div>Status</div><div>${reportStatus} · ${r.counts.warning} warnings</div>
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
    ${r.attachments?.length ? `<h3>Attachments</h3><table><tr><th>Name</th><th>On node</th><th class="num">Position (${esc(r.profile.units.name)})</th></tr>${r.attachments.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.node)}</td><td class="num">${a.position.map((v) => v.toFixed(3)).join(', ')}</td></tr>`).join('')}</table>` : ''}
    ${r.colliders?.length || r.collision === 'none' ? `<h3>Collision</h3>${r.collision === 'none' ? '<div class="note">No collision (meta.collision: none).</div>' : `<table><tr><th>Name</th><th>Shape</th><th class="num">Size (${esc(r.profile.units.name)})</th></tr>${r.colliders.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.shape)}</td><td class="num">${x.size.map((v) => v.toFixed(3)).join(' × ')}</td></tr>`).join('')}</table>`}` : ''}
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
  if (state.skin) {
    state.versionList = [];
    el.innerHTML = '<p class="muted">Choose the default skin to preview or restore asset versions.</p>';
    return;
  }
  const selectedSlug = state.slug;
  const selectedVariant = state.variant;
  const query = new URLSearchParams({ slug: state.slug });
  if (state.variant) query.set('variant', state.variant);
  const data = await api(`/api/history?${query}`).catch(() => ({ versions: [] }));
  if (selectedSlug !== state.slug || selectedVariant !== state.variant) return;
  const versions = data.versions || [];
  if (!versions.length) {
    state.versionList = [];
    el.innerHTML = '<p class="muted">No saved versions yet. Edit the working copy, then choose Save Version.</p>';
    return;
  }
  state.versionList = versions;
  el.innerHTML = `
    <p class="muted">Choose a version to preview. Restore returns the entire asset source, including base and variant values.</p>
    <div class="version ${state.version === null ? 'on' : ''}" data-version=""><div class="muted" style="display:flex;align-items:center;justify-content:center">live</div><div><div class="v">Working copy</div><div class="muted">latest build</div></div></div>
    ${versions.slice().reverse().map((v) => {
      const key = `${v.target}|${v.id}`;
      const scope = v.target === state.slug ? '' : ` <span class="muted">(${esc(v.target)})</span>`;
      return `
      <div class="version ${state.version === key ? 'on' : ''}" ${v.glb ? `data-version="${esc(key)}"` : ''}>
        ${v.glb && v.thumb ? `<img src="/files/history/${v.thumb}" alt="" onerror="this.style.display='none'">` : '<div class="muted" style="display:flex;align-items:center;justify-content:center">No preview</div>'}
        <div><div class="v">${v.id}${selectedVariant ? ` · ${esc(selectedVariant)}` : ''}${scope}${v.pinned ? ' 📌' : ''}${v.auto ? ' <span class="muted">auto</span>' : ''}</div><div>${esc(v.note || '')}</div>
        <div class="muted">${new Date(v.createdAt).toLocaleString()} · ${v.triangles?.toLocaleString() ?? '?'}△${v.glb ? '' : ' · No saved GLB for this look'}</div>
        ${v.target === state.slug ? `<button type="button" data-restore="${esc(v.id)}">Restore this version</button>` : `<code>node studio revert ${esc(v.target)} ${v.id}</code>`}</div>
      </div>`;
    }).join('')}
  `;
}

async function previewVersion(key) {
  partController?.cancel();
  if (!key) exitHistory();
  else if (!state.version) {
    state.profileBeforeVersion = state.profile;
    state.profile = 'generic';
    $('profile').value = 'generic';
    $('profile').disabled = true;
  }
  const selectionToken = ++state.viewToken;
  ++state.loadToken;
  state.version = key || null;
  state.report = null;
  renderReport();
  loadVersions();
  if (!key) {
    hideBanner();
    await editor.setContext({ slug: state.slug, variant: state.variant, skin: state.skin, profile: state.profile, version: null });
    if (selectionToken !== state.viewToken) return;
    await showCurrent();
    return;
  }
  const v = (state.versionList || []).find((x) => `${x.target}|${x.id}` === key);
  if (!v || !v.glb) return;
  await editor.setContext({ slug: state.slug, variant: state.variant, skin: state.skin, profile: state.profile, version: key });
  if (selectionToken !== state.viewToken) return;
  showBanner(`Previewing saved version ${v.id}${state.variant ? ` · ${state.variant}` : ''} (read-only). Restore returns all base and variant values.`);
  state.report = v.report ? await api(`/files/history/${v.report}`).catch(() => null) : null;
  if (selectionToken !== state.viewToken) return;
  editor.setHistoricalParts(state.report?.parts || []);
  renderReport();
  if (!v.report) $('tab-report').innerHTML = '<p class="muted">No saved report for this older version.</p>';
  try { await loadGLB(`/files/history/${v.glb}`); }
  catch (error) { showBanner(`Saved GLB could not be loaded: ${error.message}`, true); }
}

function exitHistory() {
  if (!state.version) return;
  state.profile = state.profileBeforeVersion || state.profile;
  $('profile').value = state.profile;
  $('profile').disabled = false;
  state.profileBeforeVersion = null;
  state.version = null;
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

function selectTab(name) {
  if (state.mode === 'scene') name = 'scene';
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('on', button.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('on', tab.id === `tab-${name}`));
  if (name === 'uv') renderUVPanel();
  if (name === 'versions') loadVersions();
}

const editor = new EditorController({
  onBuild: () => { partController?.cancel(); showCurrent({ forceBuild: true }); },
  onDiscardDraft: () => { partController?.cancel(); showCurrent({ allowBuild: false }); },
  onStateChange: (controller) => {
    if (!partController) return;
    partController.setLocked(controller.readOnly || controller.mutationBusy || controller.previewPending || !!controller.previewError || !controller.fresh);
    renderPartsList();
  },
  onSave: () => loadVersions(),
  onRestore: async () => {
    partController?.cancel();
    exitHistory();
    editor.context = { ...editor.context, version: null, profile: state.profile };
    editor.render();
    await editor.refresh();
    await showCurrent({ forceBuild: true });
    loadVersions();
  },
});
partController = new PartViewportController({ scene, camera, canvas, orbit: controls,
  onSelect: (id, raw, stats) => { editor.setSelectedPart(id, raw, stats); renderPartsList(); if (id || raw) selectTab('edit'); },
  onCommit: (id, value) => editor.commitPart(id, 'all', 0, null, { whole: value }),
  onDrag: (dragging) => editor.setPartDrag(dragging),
  onInvalid: (message) => editor.showAlert(message),
});

const thumbs = new ThumbnailQueue();
composer = new SceneComposer({ scene, canvas, orbit: controls, camera, onChange: () => sceneUI.render(), onStatus: setStatus });
const sceneUI = new SceneUI({ composer, thumbs, onEnter: (name) => openScene(name), getFilter: () => $('filter').value });

function setScaleRef(kind) {
  state.scaleRef = SCALE_REFS[kind] ? kind : 'off';
  $('scaleRef').value = state.scaleRef;
  composer.setScaleRef(state.scaleRef);
  if (state.mode === 'scene') return;
  applyViewSettings();
  if (state.scaleRef !== 'off') frameWithHelpers();
}

function setPartMode(mode) {
  if (partController.pendingDraft) return;
  const selectedPart = editor.snapshot?.parts?.find((part) => part.id === partController.selected);
  const capability = mode === 'translate' ? 'move' : mode === 'rotate' ? 'rotate' : mode === 'scale' ? 'scale' : null;
  if (capability && (partController.locked || !selectedPart?.editable || !selectedPart.transform?.[capability])) return;
  partController.setMode(mode);
  for (const button of document.querySelectorAll('[data-part-mode]')) button.classList.toggle('on', button.dataset.partMode === mode);
  renderPartsList();
}

// ------------------------------------------------------------------ events

$('assetList').addEventListener('click', (e) => {
  const el = e.target.closest('.asset');
  if (el) selectAsset(el.dataset.slug);
});
$('sideAssets').addEventListener('click', () => setSidebarTab('assets'));
$('sideParts').addEventListener('click', () => setSidebarTab('parts'));
$('sideScenes').addEventListener('click', () => setSidebarTab('scenes'));
$('scaleRef').addEventListener('change', (e) => setScaleRef(e.target.value));
$('partList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-part-id]');
  if (button) { partController.select(button.dataset.partId); return; }
  const raw = event.target.closest('[data-node-index]');
  if (raw) partController.selectRaw(Number(raw.dataset.nodeIndex));
});
$('partList').addEventListener('keydown', (event) => {
  const rows = [...$('partList').querySelectorAll('[role="treeitem"]')];
  const index = rows.indexOf(document.activeElement);
  if (index < 0) return;
  let next = index;
  if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1);
  else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = rows.length - 1;
  else if (event.key === 'ArrowLeft') {
    const level = Number(rows[index].getAttribute('aria-level'));
    for (let i = index - 1; i >= 0; i--) if (Number(rows[i].getAttribute('aria-level')) < level) { next = i; break; }
  } else if (event.key === 'ArrowRight') {
    if (index + 1 < rows.length && Number(rows[index + 1].getAttribute('aria-level')) > Number(rows[index].getAttribute('aria-level'))) next = index + 1;
  } else return;
  event.preventDefault();
  rows[next].focus();
});
document.querySelectorAll('[data-part-mode]').forEach((button) => button.addEventListener('click', () => setPartMode(button.dataset.partMode)));
$('partSnap').addEventListener('click', () => {
  partController.setSnap(!partController.snap);
  $('partSnap').textContent = partController.snap ? 'Snap On' : 'Snap Off';
  $('partSnap').setAttribute('aria-pressed', String(partController.snap));
});
$('filter').addEventListener('input', () => {
  if (state.sidebar === 'scenes') { sceneUI.signatures.sceneLibrary = null; sceneUI.render(); }
  else renderAssetList();
});
$('variantBar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  partController.cancel();
  exitHistory();
  const selectionToken = ++state.viewToken;
  ++state.loadToken;
  state.version = null;
  state.variant = b.dataset.variant || null;
  const asset = state.assets.find((a) => a.slug === state.slug);
  renderVariantBar(asset);
  $('title').textContent = titleText(asset);
  editor.setContext({ slug: state.slug, variant: state.variant, skin: state.skin, profile: state.profile, version: null }).then(() => {
    if (selectionToken === state.viewToken) showCurrent();
  });
  loadVersions();
});
$('skinBar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  partController.cancel();
  exitHistory();
  const selectionToken = ++state.viewToken;
  ++state.loadToken;
  state.version = null;
  state.skin = b.dataset.skin || null;
  const asset = state.assets.find((a) => a.slug === state.slug);
  renderVariantBar(asset);
  $('title').textContent = titleText(asset);
  editor.setContext({ slug: state.slug, variant: state.variant, skin: state.skin, profile: state.profile, version: null }).then(() => {
    if (selectionToken === state.viewToken) showCurrent();
  });
});
$('profile').addEventListener('change', (e) => {
  partController.cancel();
  const selectionToken = ++state.viewToken;
  ++state.loadToken;
  state.version = null;
  state.profile = e.target.value;
  localStorage.setItem('studio.profile', state.profile);
  renderAssetList();
  if (state.mode === 'scene') { composer.setProfile(state.profile, unitsOfProfile()); return; }
  editor.setContext({ slug: state.slug, variant: state.variant, skin: state.skin, profile: state.profile, version: state.version }).then(() => {
    if (selectionToken === state.viewToken) showCurrent({ keepCamera: false });
  });
});
$('lighting').addEventListener('change', (e) => {
  state.lighting = e.target.value;
  if (state.mode === 'scene' && composer.active) applyLighting(renderer, scene, state.lighting, { size: composer.contentBox().getSize(new THREE.Vector3()).length() || 1 });
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

/** Re-frame from the current direction so the asset (and the human, when shown) fits. */
function frameWithHelpers() {
  if (!content) return;
  const box = contentBox(content).clone();
  const human = helpers.getObjectByName('__human');
  if (human) box.union(new THREE.Box3().setFromObject(human));
  const dir = camera.position.clone().sub(controls.target).normalize();
  VIEWS.current = { dir: dir.toArray(), up: Math.abs(dir.y) > 0.98 ? [0, 0, -1] : [0, 1, 0] };
  const { center } = frameCamera(camera, box, 'current');
  controls.target.copy(center);
  controls.update();
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
$('uvTexture').addEventListener('change', renderUVPanel);
$('tab-versions').addEventListener('click', (e) => {
  const restore = e.target.closest('[data-restore]');
  if (restore) { editor.restore(restore.dataset.restore); return; }
  const el = e.target.closest('.version');
  if (el) previewVersion(el.dataset.version);
});
$('shot').addEventListener('click', () => {
  renderer.render(scene, composer.camera);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${state.mode === 'scene' ? `scene-${state.sceneName || 'empty'}` : itemKey() || 'viewport'}-${state.profile}.png`;
  a.click();
});
function cycleScaleRef() {
  const kinds = Object.keys(SCALE_REFS);
  setScaleRef(kinds[(kinds.indexOf(state.scaleRef) + 1) % kinds.length]);
}

/** Shortcuts of the scene composer. Returns true when the key was handled. */
function sceneKey(e, typing) {
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === 's') {
    e.preventDefault();
    if (composer.doc) sceneUI.openSaveForm();
    return true;
  }
  if (typing) return true;
  if (e.metaKey || e.ctrlKey) {
    if (key === 'z') { e.preventDefault(); e.shiftKey ? composer.redo() : composer.undo(); }
    else if (key === 'y') { e.preventDefault(); composer.redo(); }
    else if (key === 'd') { e.preventDefault(); composer.duplicateSelected(); }
    else if (key === 'a') { e.preventDefault(); composer.selectAll(); }
    else if (key === 'g') { e.preventDefault(); e.shiftKey ? composer.ungroupSelection() : composer.groupSelection(); }
    return true;
  }
  // Arrow keys nudge the selection one grid step (up = toward the back wall, as in plan view).
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && composer.selection.length) {
    e.preventDefault();
    composer.nudgeSelected(...arrows[e.key]);
    return true;
  }
  if (e.key === 'Escape') {
    if (composer.placing) composer.cancelPlacing();
    else if (composer.mode !== 'select') composer.setMode('select');
    else composer.select(null);
  } else if (e.key === 'Delete' || e.key === 'Backspace') composer.deleteSelected();
  else if (key === 'q') composer.setMode('select');
  else if (key === 't') composer.setMode('translate');
  else if (key === 'r') { if (composer.placing) composer.rotatePlacing(e.shiftKey ? 90 : -90); else composer.rotateSelected(e.shiftKey ? 90 : -90); }
  else if (key === 'p') composer.setPlan(!composer.plan);
  else if (key === 'f') { if (composer.selected) composer.focusSelected(); else composer.setView('iso'); }
  else if (key === 'h') cycleScaleRef();
  return true;
}

window.addEventListener('keydown', (e) => {
  if (state.mode === 'scene') {
    sceneKey(e, ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable);
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    editor.openSaveFromShortcut(e.target);
    return;
  }
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;
  if (typing) return;
  if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); }
    else if (e.key.toLowerCase() === 'y') { e.preventDefault(); editor.redo(); }
    return;
  }
  const map = { w: 'wire', b: 'backfaces', g: 'grid', d: 'dims' };
  if (e.key === 'h') { cycleScaleRef(); return; }
  const partMode = { q: 'select', t: 'translate', r: 'rotate', s: 'scale' };
  if (e.key === 'Escape') { setPartMode('select'); return; }
  if (partMode[e.key.toLowerCase()] && editor.snapshot?.parts?.length && !editor.readOnly) { setPartMode(partMode[e.key.toLowerCase()]); return; }
  if (map[e.key]) document.querySelector(`[data-toggle="${map[e.key]}"]`).click();
  if (e.key === 'f') setView('iso');
});

// Live updates from the server.
function eventMatchesLook(d) {
  return state.mode === 'asset' && d.slug === state.slug && (d.variant || null) === state.variant &&
    (d.skin || null) === state.skin && d.profile === state.profile && !state.version;
}

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', () => setStatus('Connected. Waiting for builds…'));
  es.addEventListener('build-start', async (e) => {
    const d = JSON.parse(e.data);
    if (eventMatchesLook(d)) {
      await editor.refresh();
      if (!eventMatchesLook(d) || (d.revision && d.revision !== editor.snapshot?.revision)) return;
      editor.markPreviewPending();
      setStatus(`Rebuilding ${d.slug} [${d.profile}]…`);
    }
  });
  es.addEventListener('scene-changed', (e) => {
    const d = JSON.parse(e.data);
    if (state.mode !== 'scene') return;
    sceneUI.refreshScenes();
    composer.onSceneChanged(d);
  });
  es.addEventListener('built', async (e) => {
    const d = JSON.parse(e.data);
    await refreshState();
    if (state.mode === 'scene') {
      if (!d.error) composer.onAssetBuilt(d);
      clearTimeout(state.libraryTimer);
      state.libraryTimer = setTimeout(() => sceneUI.refreshLibrary(), 400);
      return;
    }
    if (eventMatchesLook(d)) {
      await editor.refresh();
      if (!eventMatchesLook(d) || (d.revision && d.revision !== editor.snapshot?.revision)) return;
      if (d.error) {
        showBanner(`Build failed:\n${d.error}`, true);
        editor.setReport(state.report, { error: d.error });
        editor.showAlert(`Build failed: ${d.error}`, { 'Retry build': () => showCurrent({ forceBuild: true }), ...(editor.stack.undo.length ? { 'Undo edit': () => editor.undo() } : {}) });
        renderReport();
        setStatus(`Build failed for ${d.slug}`);
      } else {
        await showCurrent({ allowBuild: false });
      }
    }
  });
  es.onerror = () => setStatus('Disconnected from studio server — is `node studio dev` running?');
}

await refreshState();
connect();
const last = localStorage.getItem('studio.asset');
if (localStorage.getItem('studio.sidebar') === 'scenes') {
  if (last && state.assets.some((a) => a.slug === last)) state.slug = last;
  setSidebarTab('scenes');
} else if (last && state.assets.some((a) => a.slug === last)) selectAsset(last);
