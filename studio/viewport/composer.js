// Scene composer: assemble a room from library assets.
// It never builds geometry. Every instance is a clone of that asset's exported GLB (the bytes
// `export` writes), and the room shell is the GLB the scene build uses. The scene itself is
// plain data (scenes/<name>/scene.json): each committed edit autosaves that file.

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { forceSingleSided, frameCamera, makeScaleRef, VIEWS } from './scene-setup.js';
import { STUD, snapValue, snapToWalls, instanceBox, normalizeYaw, nextInstanceId, nextGroupId, groupBox, copyInstances, arrayCopies, turnAround, instancesInRect } from './snap.js';

const MAX_INSTANCES = 2000; // the same limit as studio/scene/schema.js

const UNDO_LIMIT = 50;
const SAVE_DELAY = 250;
const REPORT_DELAY = 900;
const round = (v, digits = 4) => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
const itemKey = (slug, variant, skin) => `${slug}${variant ? `--${variant}` : ''}${skin ? `@${skin}` : ''}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

async function api(path, opts) {
  const res = await fetch(path, opts);
  let body = null;
  try { body = await res.json(); } catch { body = { error: `HTTP ${res.status}` }; }
  return { ok: res.ok, status: res.status, body };
}
const jsonRequest = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export class SceneComposer {
  /**
   * @param {{scene: THREE.Scene, canvas: HTMLCanvasElement, orbit: any, camera: THREE.PerspectiveCamera,
   *          onChange: () => void, onStatus: (text: string) => void}} o
   */
  constructor({ scene, canvas, orbit, camera, onChange, onStatus }) {
    this.scene = scene;
    this.canvas = canvas;
    this.orbit = orbit;
    this.perspective = camera;
    this.onChange = onChange || (() => {});
    this.onStatus = onStatus || (() => {});
    this.loader = new GLTFLoader();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.active = false;
    this.name = null;
    this.doc = null;
    this.revision = null;
    this.profile = 'generic';
    this.units = 1;
    this.items = new Map(); // `${profile}|${item}` → { info, template, promise }
    this.objects = new Map(); // instance id → holder
    this.selection = []; // instance ids; the last one is the primary
    this.mode = 'select';
    this.snap = { grid: 0.25, wall: true, stack: false };
    this.freeMove = false;
    this.placing = null;
    this.plan = false;
    this.showCeiling = false;
    this.scaleRef = 'off';
    this.undoStack = [];
    this.redoStack = [];
    this.saveState = 'saved'; // saved | pending | saving | error | conflict
    this.alert = null; // { message, actions: { label: fn } }
    this.report = null;
    this.reportPending = false;
    this.versions = [];
    this.history = null;
    this.exportResult = null;
    this.loadingItems = 0;
    this.token = 0;

    this.root = new THREE.Group();
    this.root.name = '__scene';
    this.instancesRoot = new THREE.Group();
    this.root.add(this.instancesRoot);
    this.shellRoot = null;
    this.shellNodes = {};
    this.helpers = new THREE.Group();
    this.root.add(this.helpers);
    this.highlights = []; // one box per selected instance
    // Several selected instances move through one pivot at the middle of the block.
    this.pivot = new THREE.Object3D();
    this.pivot.name = '__selection-pivot';
    this.root.add(this.pivot);
    this.block = null; // { items: [{ id, position, yaw }], center, box } while a block is attached
    this.marquee = null;

    this.gizmo = new TransformControls(camera, canvas);
    this.gizmoHelper = this.gizmo.getHelper();
    this.gizmoHelper.visible = false;
    this.gizmo.addEventListener('dragging-changed', ({ value }) => {
      this.orbit.enabled = !value;
      this.dragging = value;
      if (!value) this.suppressClickUntil = performance.now() + 250;
    });
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    this.gizmo.addEventListener('mouseUp', () => this.commitGizmo());

    canvas.addEventListener('pointerdown', (event) => {
      this.pointerStart = [event.clientX, event.clientY];
      this.startMarquee(event);
    });
    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
    canvas.addEventListener('dblclick', (event) => this.onDoubleClick(event));
    window.addEventListener('keydown', (event) => { if (event.key === 'Alt') this.freeMove = true; });
    window.addEventListener('keyup', (event) => { if (event.key === 'Alt') this.freeMove = false; });
    window.addEventListener('blur', () => { this.freeMove = false; });
  }

  // ---------------------------------------------------------------- lifecycle

  get camera() {
    return this.active && this.plan && this.ortho ? this.ortho : this.perspective;
  }

  /** The primary selected instance id (the last one picked), or null. */
  get selected() {
    return this.selection.length ? this.selection[this.selection.length - 1] : null;
  }

  set selected(id) {
    this.selection = id ? [id] : [];
  }

  get busy() {
    return this.saveState === 'pending' || this.saveState === 'saving';
  }

  async enter(name, profile, units) {
    this.exit();
    const token = ++this.token;
    this.active = true;
    this.name = name;
    this.profile = profile;
    this.units = units;
    this.scene.add(this.root);
    this.scene.add(this.gizmoHelper);
    this.onStatus(`Loading scene ${name}…`);
    const res = await api(`/api/scene?name=${encodeURIComponent(name)}&profile=${profile}`);
    if (token !== this.token) return;
    if (!res.ok) {
      this.doc = null;
      this.setAlert(res.body.error || 'Could not load the scene.');
      this.onChange();
      return;
    }
    this.adopt(res.body);
    this.undoStack = [];
    this.redoStack = [];
    this.alert = null;
    this.exportResult = null;
    await this.rebuildScene({ frame: true });
    if (token !== this.token) return;
    this.scheduleReport(0);
  }

  exit() {
    ++this.token;
    this.cancelPlacing();
    clearTimeout(this.saveTimer);
    clearTimeout(this.reportTimer);
    if (this.plan) this.setPlan(false);
    this.gizmo.detach();
    this.gizmoHelper.visible = false;
    this.scene.remove(this.root);
    this.scene.remove(this.gizmoHelper);
    this.instancesRoot.clear();
    this.objects.clear();
    this.setShell(null);
    this.helpers.clear();
    for (const h of this.highlights) h.visible = false;
    this.cancelMarquee();
    this.block = null;
    this.active = false;
    this.name = null;
    this.doc = null;
    this.selected = null;
    this.report = null;
    this.orbit.enabled = true;
  }

  /** Take server state (scene + revision + report + versions) as the new truth. */
  adopt(payload) {
    this.doc = payload.scene;
    this.revision = payload.revision;
    this.savedJson = JSON.stringify(payload.scene);
    this.saveState = 'saved';
    if (payload.report !== undefined) this.report = payload.preview?.current ? payload.report : null;
    if (payload.versions) this.versions = payload.versions;
    if (payload.history) this.history = payload.history;
  }

  async setProfile(profile, units) {
    if (!this.active) return;
    this.profile = profile;
    this.units = units;
    this.report = null;
    await this.rebuildScene({ frame: true });
    this.scheduleReport(0);
  }

  // ---------------------------------------------------------------- items (asset GLBs)

  /** The exported GLB and real size of one placeable item (cached per profile and GLB hash). */
  ensureItem(slug, variant = null, skin = null, { refresh = false } = {}) {
    const key = `${this.profile}|${itemKey(slug, variant, skin)}`;
    if (!refresh && this.items.has(key)) return this.items.get(key).promise;
    const entry = { info: null, template: null, promise: null };
    entry.promise = (async () => {
      const query = new URLSearchParams({ slug, profile: this.profile });
      if (variant) query.set('variant', variant);
      if (skin) query.set('skin', skin);
      const res = await api(`/api/scene/item?${query}`);
      entry.info = res.ok ? res.body : { item: itemKey(slug, variant, skin), slug, variant, skin, error: res.body.error || 'not available' };
      if (entry.info.url) {
        try {
          const gltf = await this.loader.loadAsync(`${entry.info.url}?h=${entry.info.glbHash.slice(0, 12)}`);
          forceSingleSided(gltf.scene);
          entry.template = gltf.scene;
        } catch (err) {
          entry.info.error = `could not load GLB: ${err.message}`;
        }
      }
      return entry;
    })();
    this.items.set(key, entry);
    return entry.promise;
  }

  itemOf(inst) {
    return this.items.get(`${this.profile}|${itemKey(inst.asset, inst.variant, inst.skin)}`) || null;
  }

  boundsOf(inst) {
    return this.itemOf(inst)?.info?.bounds || { min: [-0.25, 0, -0.25], max: [0.25, 0.5, 0.25] };
  }

  makeHolder(inst) {
    const entry = this.itemOf(inst);
    const holder = new THREE.Group();
    holder.name = inst.id;
    holder.userData.instanceId = inst.id;
    if (entry?.template) holder.add(entry.template.clone(true));
    else {
      // Missing or broken asset: a red wire box of the default size, so the gap is visible.
      const u = this.units;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5 * u, 0.5 * u, 0.5 * u), new THREE.MeshBasicMaterial({ color: 0xff5d6c, wireframe: true }));
      box.position.y = 0.25 * u;
      holder.add(box);
      holder.userData.broken = true;
    }
    this.placeHolder(holder, inst);
    return holder;
  }

  placeHolder(holder, inst) {
    const u = this.units;
    holder.position.set(inst.position[0] * u, inst.position[1] * u, inst.position[2] * u);
    holder.rotation.set(0, (inst.yaw * Math.PI) / 180, 0);
  }

  /**
   * Rebuild every instance and the shell from this.doc (after load, undo, external edit).
   * Loading an asset can take a while (it may have to be built first). An edit made in the
   * meantime must not be lost, so a rebuild that finds a newer document simply runs again.
   */
  rebuildScene({ frame = false } = {}) {
    this.rebuildWanted = { frame: frame || !!this.rebuildWanted?.frame };
    if (!this.rebuilding) {
      this.rebuilding = (async () => {
        while (this.rebuildWanted) {
          const wanted = this.rebuildWanted;
          this.rebuildWanted = null;
          await this.rebuildOnce(wanted);
        }
      })().finally(() => { this.rebuilding = null; });
    }
    return this.rebuilding;
  }

  async rebuildOnce({ frame = false } = {}) {
    if (!this.doc) return;
    const token = this.token;
    const doc = this.doc;
    const wanted = new Map();
    for (const inst of doc.instances) wanted.set(itemKey(inst.asset, inst.variant, inst.skin), inst);
    this.loadingItems = wanted.size;
    this.onChange();
    await Promise.all([...wanted.values()].map((inst) => this.ensureItem(inst.asset, inst.variant, inst.skin)));
    if (token !== this.token) return;
    if (doc !== this.doc) {
      // Edited while loading: build the newer document instead.
      this.rebuildWanted = { frame: frame || !!this.rebuildWanted?.frame };
      return;
    }
    this.loadingItems = 0;
    this.gizmo.detach();
    this.instancesRoot.clear();
    this.objects.clear();
    for (const inst of doc.instances) {
      const holder = this.makeHolder(inst);
      this.objects.set(inst.id, holder);
      this.instancesRoot.add(holder);
    }
    this.selection = this.selection.filter((id) => this.objects.has(id));
    this.attachGizmo();
    await this.loadShell();
    if (token !== this.token) return;
    this.rebuildHelpers();
    this.attachGizmo();
    if (frame) this.setView('iso');
    this.onStatus(`Scene ${this.name} [${this.profile}] · ${doc.instances.length} instance(s)`);
    this.onChange();
  }

  // ---------------------------------------------------------------- room shell

  setShell(root) {
    if (this.shellRoot) {
      this.root.remove(this.shellRoot);
      this.shellRoot.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    this.shellRoot = root;
    this.shellNodes = {};
    if (!root) return;
    root.traverse((o) => { if (o.name) this.shellNodes[o.name] = this.shellNodes[o.name] || o; });
    this.root.add(root);
  }

  async loadShell() {
    const token = this.token;
    const roomJson = JSON.stringify(this.doc?.room || null);
    if (!this.doc?.room) {
      this.setShell(null);
      this.shellKey = roomJson;
      return;
    }
    const key = `${this.profile}|${roomJson}`;
    if (this.shellKey === key && this.shellRoot) return;
    // The shell is built from the saved scene, so unsaved room edits wait for the autosave.
    if (JSON.stringify(JSON.parse(this.savedJson).room) !== roomJson) return;
    const res = await api(`/api/scene/shell?name=${encodeURIComponent(this.name)}&profile=${this.profile}`);
    if (token !== this.token || !res.ok || !res.body.url) return;
    try {
      const gltf = await this.loader.loadAsync(res.body.url);
      if (token !== this.token) return;
      forceSingleSided(gltf.scene);
      this.setShell(gltf.scene);
      this.shellKey = key;
    } catch {
      // keep the previous shell
    }
  }

  // ---------------------------------------------------------------- helpers and view

  /** Bounds of the room or, without one, of the instances (file units). */
  contentBox() {
    const u = this.units;
    const box = new THREE.Box3();
    const room = this.doc?.room;
    if (room) {
      const t = room.wallThickness;
      box.set(new THREE.Vector3((-room.width / 2 - t) * u, -0.1 * u, (-room.depth / 2 - t) * u), new THREE.Vector3((room.width / 2 + t) * u, room.height * u, (room.depth / 2 + t) * u));
    }
    this.instancesRoot.updateMatrixWorld(true);
    if (this.instancesRoot.children.length) box.union(new THREE.Box3().setFromObject(this.instancesRoot));
    if (box.isEmpty()) box.set(new THREE.Vector3(-2 * u, 0, -2 * u), new THREE.Vector3(2 * u, 2 * u, 2 * u));
    return box;
  }

  rebuildHelpers() {
    for (const child of [...this.helpers.children]) {
      this.helpers.remove(child);
      child.traverse?.((o) => { o.geometry?.dispose?.(); });
    }
    if (!this.doc) return;
    const u = this.units;
    const room = this.doc.room;
    const step = this.snap.grid || 0.5;
    const w = room ? room.width : 12;
    const d = room ? room.depth : 12;
    // Floor grid at the snap step, drawn exactly inside the room.
    const points = [];
    const y = 0.003 * u;
    const nx = Math.floor(w / 2 / step);
    const nz = Math.floor(d / 2 / step);
    for (let i = -nx; i <= nx; i++) points.push(i * step * u, y, (-d / 2) * u, i * step * u, y, (d / 2) * u);
    for (let i = -nz; i <= nz; i++) points.push((-w / 2) * u, y, i * step * u, (w / 2) * u, y, i * step * u);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const grid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x20252b, transparent: true, opacity: nx + nz > 160 ? 0.1 : 0.22 }));
    grid.userData.__helper = true;
    this.helpers.add(grid);
    // Openings as floor markers (doors amber, windows blue), so they read in plan view too.
    for (const o of room?.openings || []) {
      const alongX = o.wall === 'front' || o.wall === 'back';
      const inset = 0.04;
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry((alongX ? o.w : 0.08) * u, 0.012 * u, (alongX ? 0.08 : o.w) * u),
        new THREE.MeshBasicMaterial({ color: o.y > 0 ? 0x6aa7ff : 0xffc857 }),
      );
      const edge = (alongX ? d : w) / 2 - inset;
      const sign = o.wall === 'front' || o.wall === 'right' ? 1 : -1;
      marker.position.set((alongX ? o.offset : sign * edge) * u, 0.008 * u, (alongX ? sign * edge : o.offset) * u);
      marker.userData.__helper = true;
      this.helpers.add(marker);
    }
    const ref = makeScaleRef(this.scaleRef, u);
    if (ref) {
      const sel = this.selectedInstance();
      if (sel) {
        const box = instanceBox(sel.position, sel.yaw, this.boundsOf(sel));
        ref.position.set((box.max[0] + 0.6) * u, 0, ((box.min[2] + box.max[2]) / 2) * u);
      }
      this.helpers.add(ref);
    }
  }

  setScaleRef(kind) {
    this.scaleRef = kind;
    if (this.active) this.rebuildHelpers();
  }

  setView(name) {
    if (!this.active || !this.doc) return;
    if (this.plan) this.setPlan(false);
    const { center } = frameCamera(this.perspective, this.contentBox(), VIEWS[name] ? name : 'iso');
    this.orbit.target.copy(center);
    this.orbit.update();
  }

  /** Plan view: orthographic camera looking straight down, ceiling hidden. */
  setPlan(on) {
    this.plan = !!on;
    if (this.plan) {
      const box = this.contentBox();
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      this.planHalf = Math.max(size.z, size.x) * 0.6;
      this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, size.y * 20 + 1000);
      this.ortho.up.set(0, 0, -1);
      this.ortho.position.set(center.x, box.max.y + size.y * 4 + 10, center.z);
      this.resize();
      this.orbit.object = this.ortho;
      this.orbit.target.set(center.x, 0, center.z);
      this.orbit.enableRotate = false;
      this.gizmo.camera = this.ortho;
    } else {
      this.orbit.object = this.perspective;
      this.orbit.enableRotate = true;
      this.gizmo.camera = this.perspective;
    }
    this.orbit.update();
    this.onChange();
  }

  resize() {
    if (!this.ortho) return;
    const rect = this.canvas.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    const half = this.planHalf || 5;
    this.ortho.left = -half * Math.max(1, aspect);
    this.ortho.right = half * Math.max(1, aspect);
    this.ortho.top = half / Math.min(1, aspect);
    this.ortho.bottom = -half / Math.min(1, aspect);
    this.ortho.updateProjectionMatrix();
  }

  /** Per frame: hide the walls between the camera and the room (dollhouse view), track the selection box. */
  update() {
    if (!this.active) return;
    const room = this.doc?.room;
    if (room && this.shellRoot) {
      const u = this.units;
      const cam = this.camera.position;
      const n = this.shellNodes;
      const outside = !this.plan;
      if (n['wall-front']) n['wall-front'].visible = !(outside && cam.z > (room.depth / 2) * u);
      if (n['wall-back']) n['wall-back'].visible = !(outside && cam.z < (-room.depth / 2) * u);
      if (n['wall-left']) n['wall-left'].visible = !(outside && cam.x < (-room.width / 2) * u);
      if (n['wall-right']) n['wall-right'].visible = !(outside && cam.x > (room.width / 2) * u);
      if (n.ceiling) n.ceiling.visible = this.showCeiling && !this.plan && cam.y < room.height * u;
    }
    // One outline per selected instance (the primary one brighter).
    const holders = this.selection.map((id) => this.objects.get(id)).filter(Boolean);
    while (this.highlights.length < holders.length) {
      const helper = new THREE.Box3Helper(new THREE.Box3(), 0x53b9ff);
      this.root.add(helper);
      this.highlights.push(helper);
    }
    this.highlights.forEach((helper, i) => {
      helper.visible = i < holders.length;
      if (!helper.visible) return;
      helper.box.setFromObject(holders[i]);
      helper.material.color.setHex(i === holders.length - 1 ? 0x53b9ff : 0x3c7fb5);
    });
  }

  // ---------------------------------------------------------------- selection and gizmo

  selectedInstance() {
    return this.doc?.instances.find((inst) => inst.id === this.selected) || null;
  }

  /** The selected instances, in document order. */
  selectedInstances() {
    const ids = new Set(this.selection);
    return (this.doc?.instances || []).filter((inst) => ids.has(inst.id));
  }

  /** Ids that belong together with `id`: its whole group, or just itself. */
  groupMembers(id) {
    const inst = this.doc?.instances.find((x) => x.id === id);
    if (!inst?.group) return [id];
    return this.doc.instances.filter((x) => x.group === inst.group).map((x) => x.id);
  }

  /**
   * Select an instance. A grouped instance brings its group along unless `single`.
   * additive: add to the selection, or take it out when it is already in.
   */
  /** An instance can be selected as soon as it is in the document, also while its asset still loads. */
  inScene(id) {
    return !!this.doc?.instances.some((inst) => inst.id === id);
  }

  select(id, { additive = false, single = false } = {}) {
    if (!id || !this.inScene(id)) {
      if (!additive) this.selection = [];
    } else {
      const ids = single ? [id] : this.groupMembers(id);
      const rest = this.selection.filter((x) => !ids.includes(x));
      if (!additive) this.selection = [...ids.filter((x) => x !== id), id];
      else if (ids.every((x) => this.selection.includes(x))) this.selection = rest;
      else this.selection = [...rest, ...ids.filter((x) => x !== id), id];
    }
    this.afterSelect();
  }

  selectMany(ids, { additive = false } = {}) {
    const wanted = ids.filter((id) => this.inScene(id));
    this.selection = additive ? [...this.selection.filter((id) => !wanted.includes(id)), ...wanted] : wanted;
    this.afterSelect();
  }

  selectAll() {
    this.selectMany((this.doc?.instances || []).map((inst) => inst.id));
  }

  afterSelect() {
    this.attachGizmo();
    if (this.scaleRef !== 'off') this.rebuildHelpers();
    this.onChange();
  }

  setMode(mode) {
    this.mode = ['select', 'translate', 'rotate'].includes(mode) ? mode : 'select';
    this.attachGizmo();
    this.onChange();
  }

  /** Selected instances that may be transformed (not locked). */
  movable() {
    return this.selectedInstances().filter((inst) => !inst.locked && this.objects.has(inst.id));
  }

  attachGizmo() {
    this.block = null;
    const movable = this.movable();
    if (!movable.length || this.mode === 'select' || this.placing) {
      this.gizmo.detach();
      this.gizmoHelper.visible = false;
      return;
    }
    if (movable.length === 1) this.gizmo.attach(this.objects.get(movable[0].id));
    else {
      // A block: the gizmo drives a pivot at the middle of its footprint, on its lowest level.
      const box = groupBox(movable, (inst) => this.boundsOf(inst));
      const center = [(box.min[0] + box.max[0]) / 2, Math.min(...movable.map((inst) => inst.position[1])), (box.min[2] + box.max[2]) / 2];
      const u = this.units;
      this.pivot.position.set(center[0] * u, center[1] * u, center[2] * u);
      this.pivot.rotation.set(0, 0, 0);
      this.block = { items: movable.map((inst) => ({ id: inst.id, position: [...inst.position], yaw: inst.yaw })), center, box };
      this.gizmo.attach(this.pivot);
    }
    this.gizmo.setMode(this.mode);
    this.gizmo.setSpace('world');
    if (this.mode === 'rotate') {
      this.gizmo.showX = false;
      this.gizmo.showZ = false;
      this.gizmo.showY = true;
      this.gizmo.setRotationSnap(this.snap.grid ? Math.PI / 12 : null);
    } else {
      this.gizmo.showX = true;
      this.gizmo.showY = true;
      this.gizmo.showZ = true;
    }
    this.gizmoHelper.visible = true;
  }

  /** Snapped pose for a position in meters (grid, then walls). */
  snapPose(position, yaw, bounds, { align = false, keepY = false } = {}) {
    let pos = [...position];
    let outYaw = yaw;
    if (this.freeMove) return { position: pos, yaw: outYaw, walls: [] };
    if (this.snap.grid) {
      pos[0] = snapValue(pos[0], this.snap.grid);
      pos[2] = snapValue(pos[2], this.snap.grid);
      if (!keepY) pos[1] = snapValue(pos[1], Math.min(this.snap.grid, 0.05));
    }
    if (!keepY && Math.abs(pos[1]) < 0.03) pos[1] = 0;
    let walls = [];
    // Reach of the wall snap: at least 15 cm, and one grid step so no grid position is left stranded short of a wall.
    const threshold = Math.min(0.3, Math.max(0.15, this.snap.grid));
    if (this.snap.wall && this.doc.room) ({ position: pos, yaw: outYaw, walls } = snapToWalls(pos, outYaw, bounds, this.doc.room, { align, threshold }));
    return { position: pos, yaw: outYaw, walls };
  }

  /** Move or turn the holders of a block to follow the pivot (a preview until the drag ends). */
  onBlockChange() {
    const { items, center, box } = this.block;
    const u = this.units;
    let moved = items;
    if (this.mode === 'translate') {
      const axis = String(this.gizmo.axis || 'XYZ');
      let delta = [this.pivot.position.x / u - center[0], this.pivot.position.y / u - center[1], this.pivot.position.z / u - center[2]];
      if (!this.freeMove) {
        // The whole block shifts by grid steps, so the spacing inside it stays as it is.
        if (this.snap.grid) {
          delta[0] = snapValue(delta[0], this.snap.grid);
          delta[2] = snapValue(delta[2], this.snap.grid);
          delta[1] = snapValue(delta[1], Math.min(this.snap.grid, 0.05));
        }
        if (this.snap.wall && this.doc.room && (axis.includes('X') || axis.includes('Z'))) {
          // The block's own box, flush against a wall it comes close to (never turned).
          const threshold = Math.min(0.3, Math.max(0.15, this.snap.grid));
          delta = snapToWalls(delta, 0, box, this.doc.room, { align: false, threshold }).position;
        }
      }
      if (!axis.includes('Y')) delta[1] = 0;
      if (!axis.includes('X') && !axis.includes('Z')) { delta[0] = 0; delta[2] = 0; }
      this.pivot.position.set((center[0] + delta[0]) * u, (center[1] + delta[1]) * u, (center[2] + delta[2]) * u);
      moved = items.map((item) => ({ ...item, position: item.position.map((v, i) => v + delta[i]) }));
    } else if (this.mode === 'rotate') {
      const deg = (new THREE.Euler().setFromQuaternion(this.pivot.quaternion, 'YXZ').y * 180) / Math.PI;
      moved = turnAround(items, [center[0], center[2]], deg);
    }
    for (const item of moved) this.placeHolder(this.objects.get(item.id), item);
    this.block.moved = moved;
  }

  commitBlock() {
    const moved = this.block?.moved;
    if (!moved) return;
    const before = new Map(this.block.items.map((item) => [item.id, item]));
    const changed = moved.filter((item) => {
      const old = before.get(item.id);
      return old.position.some((v, i) => Math.abs(v - item.position[i]) > 1e-5) || Math.abs(old.yaw - item.yaw) > 1e-3;
    });
    if (!changed.length) return this.attachGizmo();
    const byId = new Map(changed.map((item) => [item.id, item]));
    this.commit((doc) => {
      for (const inst of doc.instances) {
        const item = byId.get(inst.id);
        if (!item) continue;
        inst.position = item.position.map((v) => round(v));
        inst.yaw = round(normalizeYaw(item.yaw), 2) % 360;
      }
    });
  }

  onGizmoChange() {
    if (this.block) return this.onBlockChange();
    const inst = this.movable()[0];
    const holder = inst && this.objects.get(inst.id);
    if (!holder) return;
    const u = this.units;
    if (this.mode === 'translate') {
      const raw = [holder.position.x / u, holder.position.y / u, holder.position.z / u];
      // Only the axes being dragged are snapped, so a pure lift keeps x/z untouched.
      const axis = String(this.gizmo.axis || 'XYZ');
      const pose = this.snapPose(raw, inst.yaw, this.boundsOf(inst), { keepY: !axis.includes('Y') });
      if (!axis.includes('X') && !axis.includes('Z')) { pose.position[0] = raw[0]; pose.position[2] = raw[2]; }
      holder.position.set(pose.position[0] * u, pose.position[1] * u, pose.position[2] * u);
    }
  }

  commitGizmo() {
    if (this.block) return this.commitBlock();
    const inst = this.movable()[0];
    const holder = inst && this.objects.get(inst.id);
    if (!holder) return;
    const u = this.units;
    const position = [holder.position.x / u, holder.position.y / u, holder.position.z / u].map((v) => round(v));
    const yaw = round(normalizeYaw((new THREE.Euler().setFromQuaternion(holder.quaternion, 'YXZ').y * 180) / Math.PI), 2);
    if (position.every((v, i) => Math.abs(v - inst.position[i]) < 1e-5) && Math.abs(yaw - inst.yaw) < 1e-3) return;
    this.commit((doc) => {
      const target = doc.instances.find((x) => x.id === inst.id);
      target.position = position;
      target.yaw = yaw === 360 ? 0 : yaw;
    });
  }

  // ---------------------------------------------------------------- pointer: pick and place

  pointerRay(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, (-(event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray;
  }

  /** Where the pointer lands, in meters: the floor (y = 0), or with Stack the surface under it. */
  pointerPoint(event) {
    const ray = this.pointerRay(event);
    const u = this.units;
    if (this.snap.stack) {
      const hit = this.raycaster.intersectObjects(this.instancesRoot.children, true).find((h) => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.7);
      if (hit) return [hit.point.x / u, hit.point.y / u, hit.point.z / u];
    }
    const target = new THREE.Vector3();
    if (!ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), target)) return null;
    return [target.x / u, 0, target.z / u];
  }

  /** The instance under the pointer, or null. */
  pick(event) {
    this.pointerRay(event);
    for (const hit of this.raycaster.intersectObjects(this.instancesRoot.children, true)) {
      for (let o = hit.object; o && o !== this.instancesRoot; o = o.parent) {
        if (o.userData.instanceId) return o.userData.instanceId;
      }
    }
    return null;
  }

  /** The floor point (y = 0) under a screen position, in meters. */
  floorPoint(clientX, clientY) {
    const ray = this.pointerRay({ clientX, clientY });
    const target = new THREE.Vector3();
    if (!ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), target)) return null;
    return [target.x / this.units, target.z / this.units];
  }

  // Marquee: in plan view a left drag on the floor selects everything the rectangle touches
  // (in the normal view a left drag orbits the camera).
  startMarquee(event) {
    if (!this.active || !this.doc || !this.plan || this.placing || event.button !== 0 || this.gizmo.axis) return;
    this.marquee = { start: [event.clientX, event.clientY], active: false, additive: event.shiftKey || event.metaKey || event.ctrlKey, pointerId: event.pointerId };
  }

  updateMarquee(event) {
    const m = this.marquee;
    if (!m) return;
    if (!m.active && Math.hypot(event.clientX - m.start[0], event.clientY - m.start[1]) > 4) m.active = true;
    if (!m.active) return;
    const node = document.getElementById('sceneMarquee');
    const stage = this.canvas.getBoundingClientRect();
    node.classList.remove('hidden');
    node.style.left = `${Math.min(m.start[0], event.clientX) - stage.left}px`;
    node.style.top = `${Math.min(m.start[1], event.clientY) - stage.top}px`;
    node.style.width = `${Math.abs(event.clientX - m.start[0])}px`;
    node.style.height = `${Math.abs(event.clientY - m.start[1])}px`;
  }

  finishMarquee(event) {
    const m = this.marquee;
    this.cancelMarquee();
    if (!m?.active) return false;
    const a = this.floorPoint(m.start[0], m.start[1]);
    const b = this.floorPoint(event.clientX, event.clientY);
    if (!a || !b) return true;
    const rect = { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[1], b[1]), maxZ: Math.max(a[1], b[1]) };
    const hit = instancesInRect(this.doc.instances, (inst) => this.boundsOf(inst), rect);
    // A touched member brings its group.
    const ids = [...new Set(hit.flatMap((id) => this.groupMembers(id)))];
    this.selectMany(ids, { additive: m.additive });
    return true;
  }

  cancelMarquee() {
    this.marquee = null;
    document.getElementById('sceneMarquee')?.classList.add('hidden');
  }

  onDoubleClick(event) {
    if (!this.active || !this.doc || this.placing) return;
    const id = this.pick(event);
    if (id) this.select(id, { single: true });
  }

  onPointerMove(event) {
    if (!this.active) return;
    this.lastPointer = event;
    this.updateMarquee(event);
    if (!this.placing?.ghost) return;
    const point = this.pointerPoint(event);
    if (!point) return;
    const pose = this.snapPose(point, this.placing.yaw, this.placing.bounds, { align: true, keepY: true });
    this.placing.pose = pose;
    const u = this.units;
    this.placing.ghost.visible = true;
    this.placing.ghost.position.set(pose.position[0] * u, pose.position[1] * u, pose.position[2] * u);
    this.placing.ghost.rotation.set(0, (pose.yaw * Math.PI) / 180, 0);
  }

  onPointerUp(event) {
    if (!this.active || !this.doc) return this.cancelMarquee();
    if (this.dragging || this.gizmo.dragging) return this.cancelMarquee();
    if (this.finishMarquee(event)) return;
    if (event.button !== 0 || performance.now() < (this.suppressClickUntil || 0)) return;
    if (!this.pointerStart || Math.hypot(event.clientX - this.pointerStart[0], event.clientY - this.pointerStart[1]) > 4) return;
    if (this.placing) {
      this.onPointerMove(event);
      this.dropPlacing({ keep: event.shiftKey });
      return;
    }
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const id = this.pick(event);
    // A click on nothing clears the selection, unless more is being added to it.
    if (id || !additive) this.select(id, { additive });
  }

  /** Start placing an asset: a ghost follows the pointer until a click drops it. */
  async startPlacing({ slug, variant = null, skin = null }) {
    if (!this.active || !this.doc) return;
    this.cancelPlacing();
    const placing = { slug, variant, skin, yaw: 0, ghost: null, bounds: null, pose: null };
    this.placing = placing;
    this.gizmo.detach();
    this.gizmoHelper.visible = false;
    this.onChange();
    const entry = await this.ensureItem(slug, variant, skin);
    if (this.placing !== placing) return;
    if (!entry.template) {
      this.placing = null;
      this.setAlert(`'${itemKey(slug, variant, skin)}' cannot be placed: ${entry.info?.error || 'no preview'}`);
      return;
    }
    placing.bounds = entry.info.bounds;
    const ghost = new THREE.Group();
    ghost.add(entry.template.clone(true));
    ghost.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.opacity = 0.55;
      o.material.depthWrite = false;
    });
    ghost.visible = false;
    placing.ghost = ghost;
    this.root.add(ghost);
    // Show it under the pointer right away (the asset may have taken a moment to build).
    if (this.lastPointer) this.onPointerMove(this.lastPointer);
    this.onChange();
  }

  rotatePlacing(deg) {
    if (!this.placing) return;
    this.placing.yaw = normalizeYaw(this.placing.yaw + deg);
    if (this.placing.ghost && this.placing.pose) this.placing.ghost.rotation.y = (this.placing.yaw * Math.PI) / 180;
  }

  dropPlacing({ keep = false } = {}) {
    const placing = this.placing;
    if (!placing?.pose) return;
    const id = nextInstanceId(placing.slug, this.doc.instances.map((inst) => inst.id));
    const pose = placing.pose;
    this.commit((doc) => {
      doc.instances.push({ id, asset: placing.slug, variant: placing.variant, skin: placing.skin, position: pose.position.map((v) => round(v)), yaw: round(normalizeYaw(pose.yaw), 2) });
    }, { rebuild: true, select: keep ? this.selected : id });
    if (!keep) this.cancelPlacing();
  }

  cancelPlacing() {
    const placing = this.placing;
    if (!placing) return;
    this.placing = null;
    if (placing.ghost) {
      placing.ghost.traverse((o) => { if (o.isMesh) o.material.dispose(); });
      this.root.remove(placing.ghost);
    }
    this.attachGizmo();
    this.onChange();
  }

  // ---------------------------------------------------------------- edits

  /**
   * One undoable change: `mutate` edits a copy of the document, which is validated by the
   * server on autosave. rebuild: the set of instances or their assets changed.
   */
  commit(mutate, { rebuild = false, select = undefined } = {}) {
    if (!this.doc || this.saveState === 'conflict') return;
    const before = JSON.stringify(this.doc);
    const next = clone(this.doc);
    mutate(next);
    if (JSON.stringify(next) === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.applyDoc(next, { rebuild, select });
  }

  applyDoc(next, { rebuild = false, select = undefined } = {}) {
    const roomChanged = JSON.stringify(next.room) !== JSON.stringify(this.doc.room);
    this.doc = next;
    if (select !== undefined) this.selection = Array.isArray(select) ? [...select] : select ? [select] : [];
    this.exportResult = null;
    this.report = null;
    this.scheduleSave();
    if (rebuild) this.rebuildScene();
    else {
      for (const inst of next.instances) {
        const holder = this.objects.get(inst.id);
        if (holder) this.placeHolder(holder, inst);
      }
      this.selection = this.selection.filter((id) => next.instances.some((inst) => inst.id === id));
      if (roomChanged) this.rebuildHelpers();
      this.attachGizmo();
      this.onChange();
    }
  }

  undo() {
    if (!this.undoStack.length || !this.doc || this.saveState === 'conflict') return;
    this.redoStack.push(JSON.stringify(this.doc));
    this.applyDoc(JSON.parse(this.undoStack.pop()), { rebuild: true });
  }

  redo() {
    if (!this.redoStack.length || !this.doc || this.saveState === 'conflict') return;
    this.undoStack.push(JSON.stringify(this.doc));
    this.applyDoc(JSON.parse(this.redoStack.pop()), { rebuild: true });
  }

  updateInstance(id, patch) {
    const changesItem = ['asset', 'variant', 'skin'].some((key) => key in patch);
    this.commit((doc) => {
      const inst = doc.instances.find((x) => x.id === id);
      if (!inst) return;
      Object.assign(inst, patch);
      if (inst.locked === false) delete inst.locked;
      if (inst.name === '') delete inst.name;
    }, { rebuild: changesItem });
  }

  usedIds() {
    return new Set(this.doc.instances.map((inst) => inst.id));
  }

  usedGroups() {
    return new Set(this.doc.instances.map((inst) => inst.group).filter(Boolean));
  }

  deleteSelected() {
    const ids = new Set(this.selection);
    if (!ids.size) return;
    this.commit((doc) => { doc.instances = doc.instances.filter((inst) => !ids.has(inst.id)); }, { rebuild: true, select: null });
  }

  /** Copy the selection one grid step aside; the copies become the selection. */
  duplicateSelected() {
    const selected = this.selectedInstances();
    if (!selected.length) return;
    if (this.doc.instances.length + selected.length > MAX_INSTANCES) return this.setAlert(`A scene holds at most ${MAX_INSTANCES} instances.`);
    const step = this.snap.grid || 0.25;
    const copies = copyInstances(selected, [step, 0, step], this.usedIds(), this.usedGroups());
    this.commit((doc) => { doc.instances.push(...copies); }, { rebuild: true, select: copies.map((inst) => inst.id) });
  }

  /**
   * Repeat the selection on a grid: `columns` along X every `dx` meters, `rows` along Z every
   * `dz` meters. The block and all its copies become the selection.
   */
  arraySelection({ columns = 1, rows = 1, dx = 0, dz = 0 }) {
    const selected = this.selectedInstances();
    const cells = Math.max(1, Math.floor(columns)) * Math.max(1, Math.floor(rows));
    if (!selected.length || cells < 2) return;
    if (this.doc.instances.length + selected.length * (cells - 1) > MAX_INSTANCES) {
      return this.setAlert(`That array would pass the limit of ${MAX_INSTANCES} instances in a scene.`);
    }
    const copies = arrayCopies(selected, { columns: Math.floor(columns), rows: Math.floor(rows), dx, dz }, this.usedIds(), this.usedGroups());
    this.commit((doc) => { doc.instances.push(...copies); }, { rebuild: true, select: [...copies.map((inst) => inst.id), ...selected.map((inst) => inst.id)] });
  }

  /** World box of the selection in meters (for default array spacing and the inspector), or null. */
  selectionBox() {
    const selected = this.selectedInstances();
    return selected.length ? groupBox(selected, (inst) => this.boundsOf(inst)) : null;
  }

  /** Make the selection one group: it is picked and moved as a unit, and exported under one node. */
  groupSelection() {
    const ids = new Set(this.selection);
    if (ids.size < 2) return;
    const group = nextGroupId(this.usedGroups());
    this.commit((doc) => {
      for (const inst of doc.instances) if (ids.has(inst.id)) inst.group = group;
    });
  }

  ungroupSelection() {
    const ids = new Set(this.selection);
    this.commit((doc) => {
      for (const inst of doc.instances) if (ids.has(inst.id)) delete inst.group;
    });
  }

  renameGroup(from, to) {
    if (!from || !to || from === to) return;
    this.commit((doc) => {
      for (const inst of doc.instances) if (inst.group === from) inst.group = to;
    });
  }

  rotateSelected(deg) {
    const movable = this.movable();
    if (!movable.length) return;
    if (movable.length === 1) return this.updateInstance(movable[0].id, { yaw: round(normalizeYaw(movable[0].yaw + deg), 2) });
    // A block turns around the middle of its footprint.
    const box = groupBox(movable, (inst) => this.boundsOf(inst));
    const turned = new Map(turnAround(movable, [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2], deg).map((item) => [item.id, item]));
    this.commit((doc) => {
      for (const inst of doc.instances) {
        const item = turned.get(inst.id);
        if (item) { inst.position = item.position; inst.yaw = item.yaw; }
      }
    });
  }

  /** Move the selection by a fixed step (arrow keys): [dx, dz] in grid steps. */
  nudgeSelected(stepsX, stepsZ) {
    const ids = new Set(this.movable().map((inst) => inst.id));
    if (!ids.size) return;
    const step = this.snap.grid || 0.05;
    this.commit((doc) => {
      for (const inst of doc.instances) {
        if (ids.has(inst.id)) inst.position = [round(inst.position[0] + stepsX * step), inst.position[1], round(inst.position[2] + stepsZ * step)];
      }
    });
  }

  setLockedSelected(locked) {
    const ids = new Set(this.selection);
    this.commit((doc) => {
      for (const inst of doc.instances) {
        if (!ids.has(inst.id)) continue;
        if (locked) inst.locked = true;
        else delete inst.locked;
      }
    });
  }

  /** Rest every selected instance on whatever is under its center (an asset outside the selection, or the floor). */
  dropSelected() {
    const movable = this.movable();
    if (!movable.length) return;
    const u = this.units;
    const chosen = new Set(movable.map((inst) => this.objects.get(inst.id)));
    const others = this.instancesRoot.children.filter((child) => !chosen.has(child));
    const heights = new Map();
    for (const inst of movable) {
      this.raycaster.set(new THREE.Vector3(inst.position[0] * u, 1e4, inst.position[2] * u), new THREE.Vector3(0, -1, 0));
      const hit = this.raycaster.intersectObjects(others, true)[0];
      heights.set(inst.id, hit ? round(hit.point.y / u) : 0);
    }
    this.commit((doc) => {
      for (const inst of doc.instances) if (heights.has(inst.id)) inst.position = [inst.position[0], heights.get(inst.id), inst.position[2]];
    });
  }

  focusSelected() {
    const holders = this.selection.map((id) => this.objects.get(id)).filter(Boolean);
    if (!holders.length || this.plan) return;
    const box = new THREE.Box3();
    for (const holder of holders) box.union(new THREE.Box3().setFromObject(holder));
    const dir = this.perspective.position.clone().sub(this.orbit.target).normalize();
    VIEWS.current = { dir: dir.toArray(), up: [0, 1, 0] };
    const { center } = frameCamera(this.perspective, box, 'current', { fit: 2.2 });
    this.orbit.target.copy(center);
    this.orbit.update();
  }

  setSnap(patch) {
    Object.assign(this.snap, patch);
    this.rebuildHelpers();
    this.attachGizmo();
    this.onChange();
  }

  // ---------------------------------------------------------------- room edits

  updateRoom(patch) {
    this.commit((doc) => {
      if (!doc.room) return;
      Object.assign(doc.room, patch);
    });
  }

  setRoom(room) {
    this.commit((doc) => { doc.room = room; });
  }

  addOpening(kind) {
    this.commit((doc) => {
      if (!doc.room) return;
      doc.room.openings.push(kind === 'window' ? { wall: 'back', offset: 0, y: 0.9, w: 1.2, h: 1.2, shape: 'rect' } : { wall: 'front', offset: 0, y: 0, w: 0.9, h: 2.1, shape: 'rect' });
    });
  }

  updateOpening(index, patch) {
    this.commit((doc) => {
      if (doc.room?.openings[index]) Object.assign(doc.room.openings[index], patch);
    });
  }

  removeOpening(index) {
    this.commit((doc) => { doc.room?.openings.splice(index, 1); });
  }

  // ---------------------------------------------------------------- persistence

  setAlert(message, actions = {}) {
    this.alert = message ? { message, actions } : null;
    this.onChange();
  }

  scheduleSave() {
    this.saveState = 'pending';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY);
  }

  /** Write the working copy now. Resolves true when the server has it. */
  async save() {
    clearTimeout(this.saveTimer);
    if (!this.doc || !this.name) return false;
    if (this.saving) {
      this.saveAgain = true;
      return this.saving;
    }
    const json = JSON.stringify(this.doc);
    if (json === this.savedJson) {
      this.saveState = 'saved';
      this.onChange();
      return true;
    }
    const name = this.name;
    const token = this.token;
    this.saveState = 'saving';
    this.onChange();
    this.saving = (async () => {
      const res = await api('/api/scene', jsonRequest('PUT', { name, profile: this.profile, scene: JSON.parse(json), expectedRevision: this.revision })).catch((err) => ({ ok: false, status: 0, body: { error: err.message } }));
      if (token !== this.token) return false;
      if (res.ok) {
        this.revision = res.body.revision;
        this.savedJson = json;
        this.history = res.body.history;
        // Room edits are validated and normalized by the server: adopt its copy when nothing changed meanwhile.
        if (JSON.stringify(this.doc) === json && JSON.stringify(res.body.scene) !== json) {
          this.doc = res.body.scene;
          this.savedJson = JSON.stringify(res.body.scene);
        }
        this.saveState = 'saved';
        if (this.alert?.kind !== 'export') this.alert = null;
        await this.loadShell();
        this.scheduleReport();
        return true;
      }
      if (res.status === 409) {
        this.saveState = 'conflict';
        const current = res.body.current;
        this.setAlert('The scene changed on disk (an agent or another window saved it).', {
          'Reload from disk': () => this.reloadFromDisk(),
          ...(current ? { 'Keep mine': () => { this.revision = current.revision; this.saveState = 'pending'; this.alert = null; this.save(); } } : {}),
        });
        return false;
      }
      // Invalid edit (e.g. an opening that no longer fits): go back to the last saved state.
      this.saveState = 'error';
      const message = res.body.error || 'Autosave failed.';
      if (res.status === 400) {
        this.doc = JSON.parse(this.savedJson);
        this.undoStack.pop();
        this.saveState = 'saved';
        await this.rebuildScene();
        this.setAlert(`Change rejected: ${message}`);
      } else this.setAlert(`Autosave failed: ${message}`, { Retry: () => this.save() });
      return false;
    })();
    const result = await this.saving;
    this.saving = null;
    if (this.saveAgain) {
      this.saveAgain = false;
      return this.save();
    }
    this.onChange();
    return result;
  }

  async reloadFromDisk() {
    const res = await api(`/api/scene?name=${encodeURIComponent(this.name)}&profile=${this.profile}`);
    if (!res.ok) return this.setAlert(res.body.error || 'Could not reload the scene.');
    this.adopt(res.body);
    this.undoStack = [];
    this.redoStack = [];
    this.alert = null;
    this.shellKey = null;
    await this.rebuildScene();
    this.scheduleReport(0);
  }

  /** The server reports an edit to scene.json that did not come from this window. */
  onSceneChanged({ name, revision }) {
    if (!this.active || name !== this.name || !revision || revision === this.revision) return;
    if (this.busy || this.saving) return; // our own save is in flight; a real conflict shows on its response
    if (JSON.stringify(this.doc) !== this.savedJson) return;
    this.reloadFromDisk().then(() => this.onStatus(`Scene ${this.name} reloaded: it changed on disk`));
  }

  /** An asset was rebuilt: refresh the instances that use it. */
  async onAssetBuilt({ slug, profile }) {
    if (!this.active || !this.doc || profile !== this.profile) return;
    const used = this.doc.instances.filter((inst) => inst.asset === slug);
    if (!used.length) return;
    const seen = new Set();
    for (const inst of used) {
      const key = itemKey(inst.asset, inst.variant, inst.skin);
      if (seen.has(key)) continue;
      seen.add(key);
      await this.ensureItem(inst.asset, inst.variant, inst.skin, { refresh: true });
    }
    await this.rebuildScene();
    this.scheduleReport();
  }

  scheduleReport(delay = REPORT_DELAY) {
    clearTimeout(this.reportTimer);
    if (!this.active) return;
    this.reportPending = true;
    this.reportTimer = setTimeout(() => this.buildReport(), delay);
  }

  /** Compose the scene on the server for totals and issues (members are cached, so this is quick). */
  async buildReport() {
    if (!this.active || !this.doc || this.busy) return;
    const token = this.token;
    const revision = this.revision;
    this.onChange();
    const res = await api('/api/scene/build', jsonRequest('POST', { name: this.name, profile: this.profile, expectedRevision: revision })).catch(() => null);
    if (token !== this.token || revision !== this.revision) return;
    this.reportPending = false;
    if (res?.ok) this.report = res.body.report;
    this.onChange();
  }

  async exportScene() {
    if (!this.active || !this.doc) return;
    this.exportResult = { pending: true };
    this.onChange();
    if (!(await this.save())) {
      this.exportResult = null;
      this.onChange();
      return;
    }
    const res = await api('/api/scene/export', jsonRequest('POST', { name: this.name, profile: this.profile, expectedRevision: this.revision })).catch((err) => ({ ok: false, body: { error: err.message } }));
    if (!res.ok) this.exportResult = { blocked: true, reason: res.body.error || 'export failed', errors: [] };
    else {
      this.exportResult = { ...res.body.result, profile: this.profile };
      this.report = res.body.report || this.report;
    }
    this.onChange();
  }

  async saveVersion(note) {
    if (!(await this.save())) return false;
    const res = await api('/api/scene/save', jsonRequest('POST', { name: this.name, profile: this.profile, note, expectedRevision: this.revision }));
    if (!res.ok) {
      this.setAlert(res.body.error || 'Could not save a version.');
      return false;
    }
    this.versions = res.body.versions;
    this.history = res.body.history;
    this.onChange();
    return true;
  }

  async restoreVersion(version) {
    if (!(await this.save())) return;
    const res = await api('/api/scene/restore', jsonRequest('POST', { name: this.name, profile: this.profile, version }));
    if (!res.ok) return this.setAlert(res.body.error || 'Could not restore that version.');
    this.adopt(res.body);
    this.undoStack = [];
    this.redoStack = [];
    this.shellKey = null;
    await this.rebuildScene();
    this.scheduleReport(0);
  }
}

export { STUD };
