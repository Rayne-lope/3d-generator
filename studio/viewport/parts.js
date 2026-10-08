import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const identity = () => ({ move: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 });

function cloneExportedSubtree(node) {
  // Object3D.clone() JSON-clones userData, which turns __orig Material into a plain
  // object. View modes need the actual Material reference to restore shading.
  const copy = node.clone(false);
  copy.userData = { ...node.userData };
  delete copy.userData.__wire;
  delete copy.userData.__back;
  for (const child of node.children) if (!child.userData.__helper) copy.add(cloneExportedSubtree(child));
  return copy;
}

function disposeDraftHelpers(root) {
  root.traverse((object) => {
    if (!object.userData.__helper) return;
    // Backface overlays reuse the exported mesh geometry; wire helpers own theirs.
    if (object.parent?.userData.__wire === object) object.geometry?.dispose();
    object.material?.dispose();
  });
}

/** Convert a GLB node's parent-local drag into the authored part parent's local meters. */
export function sourceMoveDeltaFromGLB(localDelta, glbParentWorldMatrix, sourceParentWorldMatrix, unitsPerMeter) {
  const glbLinear = new THREE.Matrix3().setFromMatrix4(glbParentWorldMatrix);
  const sourceLinear = new THREE.Matrix3().setFromMatrix4(sourceParentWorldMatrix).invert();
  return localDelta.clone().applyMatrix3(glbLinear).divideScalar(unitsPerMeter).applyMatrix3(sourceLinear);
}

/** Selection and temporary draft transforms of exported GLB nodes. */
export class PartViewportController {
  constructor({ scene, camera, canvas, orbit, onSelect, onCommit, onDrag, onInvalid }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.orbit = orbit;
    this.onSelect = onSelect;
    this.onCommit = onCommit;
    this.onDrag = onDrag;
    this.onInvalid = onInvalid;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.gizmo = new TransformControls(camera, canvas);
    this.gizmo.visible = false;
    this.scene.add(this.gizmo.getHelper());
    this.box = new THREE.Box3();
    this.highlight = new THREE.Box3Helper(this.box, 0x53b9ff);
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.mode = 'select';
    this.snap = false;
    this.parts = [];
    this.rawNodes = [];
    this.selectedRaw = null;
    this.units = 1;
    this.selected = null;
    this.readOnly = true;
    this.dragging = false;
    this.locked = false;
    this.pendingDraft = null;
    this.suppressClickUntil = 0;
    this.gizmo.addEventListener('mouseDown', () => {
      if (!this.draft || this.readOnly) return;
      this.dragging = true;
      this.onDrag?.(true);
    });
    this.gizmo.addEventListener('mouseUp', () => this.finishDrag());
    this.gizmo.addEventListener('dragging-changed', ({ value }) => { this.orbit.enabled = !value; });
    this.gizmo.addEventListener('objectChange', () => {
      if (this.mode === 'scale' && this.draft && this.original) {
        const axis = String(this.gizmo.axis || 'X');
        const index = axis.includes('Y') && !axis.includes('X') ? 'y' : axis.includes('Z') && !axis.includes('X') && !axis.includes('Y') ? 'z' : 'x';
        const ratio = this.draft.scale[index] / this.original.scale[index];
        if (Number.isFinite(ratio) && ratio > 0) this.draft.scale.copy(this.original.scale).multiplyScalar(ratio);
      }
      this.updateHighlight();
    });
    canvas.addEventListener('pointerdown', (event) => { this.pointerStart = [event.clientX, event.clientY]; });
    canvas.addEventListener('pointerup', (event) => this.pick(event));
  }

  setContext({ content, parts = [], units = 1, readOnly = true }) {
    const previous = this.selected;
    this.cancel();
    this.content = content;
    this.rawNodes = [];
    const visit = (node, parent = null, depth = 0) => {
      const index = this.rawNodes.length;
      this.rawNodes.push({ index, node, parent, depth, name: node.name || (node.isMesh ? 'mesh' : 'node'), partId: node.userData?.studio?.partId || null, hasMesh: !!node.isMesh });
      for (const child of node.children) visit(child, index, depth + 1);
    };
    for (const child of content?.children || []) visit(child);
    this.parts = parts;
    this.units = units;
    this.readOnly = readOnly;
    this.locked = readOnly;
    this.select(previous && parts.some((part) => part.id === previous) ? previous : null);
  }

  findNode(id) {
    let found = null;
    this.content?.traverse((object) => {
      if (object.userData?.studio?.partId === id && !found) found = object;
    });
    return found;
  }

  statsFor(node) {
    if (!node) return null;
    let triangles = 0;
    const materials = new Set();
    node.traverse((object) => {
      if (!object.isMesh || object.userData.__helper || !object.geometry) return;
      triangles += (object.geometry.index?.count || object.geometry.attributes.position?.count || 0) / 3;
      const assigned = object.userData.__orig || object.material;
      for (const material of Array.isArray(assigned) ? assigned : [assigned]) if (material?.name) materials.add(material.name);
    });
    return { triangles: Math.round(triangles), materials: [...materials].sort() };
  }

  select(id) {
    this.cancel();
    this.selectedRaw = null;
    this.selected = id && this.parts.some((part) => part.id === id) ? id : null;
    this.original = this.selected ? this.findNode(this.selected) : null;
    this.onSelect?.(this.selected, null, this.statsFor(this.original));
    this.attachDraft();
    this.updateHighlight();
  }

  selectRaw(index) {
    const raw = this.rawNodes[index];
    this.cancel();
    this.selected = null;
    this.selectedRaw = raw || null;
    this.original = raw?.node || null;
    this.onSelect?.(null, raw ? { name: raw.name, partId: raw.partId, hasMesh: raw.hasMesh, parent: raw.parent } : null, this.statsFor(this.original));
    this.updateHighlight();
  }

  setMode(mode) {
    if (this.pendingDraft) return;
    this.mode = ['select', 'translate', 'rotate', 'scale'].includes(mode) ? mode : 'select';
    this.cancel();
    this.attachDraft();
  }

  setLocked(locked) {
    if (this.locked === !!locked) return;
    this.locked = !!locked;
    if (this.locked) {
      this.gizmo.detach();
      this.gizmo.getHelper().visible = false;
      if (!this.pendingDraft && this.draft) this.cancel();
    } else if (!this.draft) this.attachDraft();
  }

  setSnap(enabled) {
    this.snap = !!enabled;
    this.gizmo.setTranslationSnap(this.snap ? 0.01 * this.units : null);
    this.gizmo.setRotationSnap(this.snap ? Math.PI / 12 : null);
    const sourceScale = this.parts.find((part) => part.id === this.selected)?.value?.scale || 1;
    this.gizmo.setScaleSnap(this.snap ? 0.05 / sourceScale : null);
  }

  attachDraft() {
    const part = this.parts.find((item) => item.id === this.selected);
    const capability = this.mode === 'translate' ? 'move' : this.mode === 'rotate' ? 'rotate' : this.mode === 'scale' ? 'scale' : null;
    if (!this.original || this.readOnly || this.locked || !part?.editable || !part.transform?.[capability] || this.mode === 'select') {
      this.gizmo.detach();
      this.gizmo.getHelper().visible = false;
      return;
    }
    this.draft = cloneExportedSubtree(this.original);
    this.draft.name = `${this.original.name}__draft`;
    this.original.parent.add(this.draft);
    this.original.visible = false;
    this.gizmo.attach(this.draft);
    this.gizmo.setMode(this.mode);
    this.gizmo.setSpace(this.mode === 'translate' ? 'world' : 'local');
    this.setSnap(this.snap);
    this.gizmo.getHelper().visible = true;
    this.updateHighlight();
  }

  cancel() {
    this.gizmo.detach();
    this.gizmo.getHelper().visible = false;
    if (this.draft) { disposeDraftHelpers(this.draft); this.draft.parent?.remove(this.draft); }
    if (this.original) this.original.visible = true;
    this.draft = null;
    this.pendingDraft = null;
    this.dragging = false;
    this.orbit.enabled = true;
    this.onDrag?.(false);
    this.updateHighlight();
  }

  finishDrag() {
    if (!this.dragging || !this.draft || !this.original) return;
    const part = this.parts.find((item) => item.id === this.selected);
    const old = structuredClone(part?.value || identity());
    const delta = this.draft.position.clone().sub(this.original.position);
    const parentMatrix = new THREE.Matrix4().fromArray(part?.parentWorldMatrix || new THREE.Matrix4().toArray());
    const sourceDelta = sourceMoveDeltaFromGLB(delta, this.original.parent.matrixWorld, parentMatrix, this.units);
    old.move = old.move.map((v, i) => v + sourceDelta.getComponent(i));
    const q0 = this.original.quaternion.clone();
    const q1 = this.draft.quaternion.clone();
    old.rotation = new THREE.Quaternion(...old.rotation).multiply(q0.invert().multiply(q1)).normalize().toArray();
    old.scale *= this.draft.scale.x / this.original.scale.x;
    if (this.snap) old.scale = Math.round(old.scale / 0.05) * 0.05;
    if (old.move.some((n) => !Number.isFinite(n) || Math.abs(n) > 2) || !Number.isFinite(old.scale) || old.scale < 0.25 || old.scale > 4) {
      this.cancel();
      this.onInvalid?.('Part transform is outside the allowed range.');
      return;
    }
    const selected = this.selected;
    this.suppressClickUntil = performance.now() + 250;
    this.dragging = false;
    this.pendingDraft = { id: selected, value: old };
    this.gizmo.detach();
    this.gizmo.getHelper().visible = false;
    this.locked = true;
    this.orbit.enabled = true;
    this.onDrag?.(false);
    this.onCommit?.(selected, old);
    this.updateHighlight();
  }

  updateHighlight() {
    const node = this.draft || this.original;
    this.highlight.visible = !!node;
    if (node) this.box.setFromObject(node, true);
  }

  update() { if (this.highlight.visible) this.updateHighlight(); }

  pick(event) {
    if (!this.content || performance.now() < this.suppressClickUntil || this.dragging || event.button !== 0) return;
    if (!this.pointerStart || Math.hypot(event.clientX - this.pointerStart[0], event.clientY - this.pointerStart[1]) > 4) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const isHelper = (node) => {
      for (let current = node; current && current !== this.content; current = current.parent) if (current.userData?.__helper) return true;
      return false;
    };
    const hits = this.raycaster.intersectObject(this.content, true).filter((hit) => !isHelper(hit.object));
    for (const hit of hits) {
      let object = hit.object;
      while (object && object !== this.content) {
        const id = object.userData?.studio?.partId;
        if (id && this.parts.some((part) => part.id === id)) { this.select(id); return; }
        object = object.parent;
      }
    }
    if (hits.length) {
      let node = hits[0].object;
      while (node && !this.rawNodes.some((entry) => entry.node === node)) node = node.parent;
      const raw = this.rawNodes.find((entry) => entry.node === node);
      this.selectRaw(raw?.index);
    } else this.select(null);
  }
}
