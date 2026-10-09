// DOM side of the scene composer: scene picker, outliner, library cards, instance inspector,
// room form, scene report and versions. All state lives in SceneComposer; this file renders
// it and turns input into composer calls.

import { STUD, WALLS } from './snap.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
// Kept in step with FINISH_KINDS in studio/scene/schema.js (the server validates every save).
const FINISH_KINDS = ['plaster', 'concrete', 'brick', 'stone', 'wood', 'painted-wood', 'varnished-wood', 'ceramic', 'plastic', 'fabric', 'rubber'];
const WALL_LABEL = { front: 'Front (+Z)', back: 'Back (−Z)', left: 'Left (−X)', right: 'Right (+X)' };
const fmt = (v, digits = 2) => (Number.isFinite(v) ? Number(v.toFixed(digits)).toString() : '');
const sizeText = (m) => (m ? `${m[0].toFixed(2)} × ${m[2].toFixed(2)} × ${m[1].toFixed(2)} m` : 'not built');

export class SceneUI {
  /**
   * @param {{composer: any, thumbs: any, onEnter: (name: string|null) => void, getFilter: () => string}} o
   */
  constructor({ composer, thumbs, onEnter, getFilter }) {
    this.composer = composer;
    this.thumbs = thumbs;
    this.onEnter = onEnter;
    this.getFilter = getFilter;
    this.scenes = [];
    this.library = [];
    this.libraryBySlug = new Map();
    this.signatures = {};
    this.queued = false;
    this.collapsedGroups = new Set();
    // Array panel: null spacing = the block's own size (copies touch).
    this.array = { columns: 2, rows: 1, dx: null, dz: null };
    this.arrayFor = '';
    this.bind();
  }

  // ---------------------------------------------------------------- data

  async refreshScenes() {
    try {
      this.scenes = (await (await fetch('/api/scenes')).json()).scenes || [];
    } catch {
      this.scenes = [];
    }
    this.signatures.bar = null;
    this.render();
  }

  async refreshLibrary() {
    try {
      this.library = (await (await fetch('/api/library')).json()).assets || [];
    } catch {
      this.library = [];
    }
    this.libraryBySlug = new Map(this.library.map((a) => [a.slug, a]));
    this.signatures.library = null;
    this.render();
  }

  // ---------------------------------------------------------------- rendering

  /** Render on the next frame (the composer calls this often). */
  render() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.renderNow();
    });
  }

  /** Replace a section's HTML when its content changed and the user is not typing in it. */
  section(id, signature, html) {
    const node = $(id);
    if (this.signatures[id] === signature) return false;
    if (node.contains(document.activeElement) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && this.signatures[id] !== null && this.signatures[id] !== undefined) {
      this.dirtySections = true;
      return false;
    }
    this.signatures[id] = signature;
    node.innerHTML = html();
    return true;
  }

  renderNow() {
    const c = this.composer;
    this.renderBar();
    this.renderLibrary();
    this.renderToolbar();
    if (!c.active) return;
    this.renderOutliner();
    this.renderStatus();
    this.renderAlert();
    this.renderInspector();
    this.renderArray();
    this.renderRoom();
    this.renderReport();
    this.renderVersions();
    this.renderExport();
  }

  renderBar() {
    const c = this.composer;
    this.section('sceneSelect', JSON.stringify([this.scenes.map((s) => [s.name, s.title]), c.name]), () => `<option value="">${this.scenes.length ? 'Choose a scene…' : 'No scenes yet'}</option>${this.scenes.map((s) => `<option value="${esc(s.name)}" ${s.name === c.name ? 'selected' : ''}>${esc(s.title || s.name)}${s.error ? ' (invalid)' : ''}</option>`).join('')}`);
    $('sceneSelect').value = c.name || '';
  }

  renderOutliner() {
    const c = this.composer;
    const doc = c.doc;
    const chosen = new Set(c.selection);
    const rows = (doc?.instances || []).map((inst) => {
      const entry = c.itemOf(inst);
      return [inst.id, inst.name || '', inst.asset, inst.variant, inst.skin, !!inst.locked, entry?.info?.error || '', inst.group || '', chosen.has(inst.id)];
    });
    this.section('sceneOutliner', JSON.stringify([rows, c.name, !!doc, [...this.collapsedGroups]]), () => {
      if (!doc) return '<p class="muted">Choose a scene above, or create one.</p>';
      const head = `<div class="group-title">Placed · ${doc.instances.length}${chosen.size > 1 ? ` · ${chosen.size} selected` : ''}</div>`;
      if (!doc.instances.length) return `${head}<p class="muted">Nothing placed yet. Pick an asset below, then click in the room.</p>`;
      const row = (inst, indent) => {
        const entry = c.itemOf(inst);
        const title = this.libraryBySlug.get(inst.asset)?.title || inst.asset;
        const tag = entry?.info?.error ? '<span class="part-tag" style="color:var(--err)">missing</span>' : `<span class="part-tag">${inst.locked ? 'locked' : esc(inst.variant || inst.skin || '')}</span>`;
        return `<button type="button" class="part-tree-row ${chosen.has(inst.id) ? 'selected' : ''}" data-instance="${esc(inst.id)}" title="${esc(title)}" ${indent ? 'style="padding-left:24px"' : ''}><span>◇</span><span class="scene-row-name">${esc(inst.name || inst.id)}</span>${tag}</button>`;
      };
      const out = [head];
      const done = new Set();
      for (const inst of doc.instances) {
        if (!inst.group) {
          out.push(row(inst, false));
          continue;
        }
        if (done.has(inst.group)) continue;
        done.add(inst.group);
        const members = doc.instances.filter((x) => x.group === inst.group);
        const open = !this.collapsedGroups.has(inst.group);
        const all = members.every((x) => chosen.has(x.id));
        out.push(`<button type="button" class="part-tree-row scene-group ${all ? 'selected' : ''}" data-group="${esc(inst.group)}" title="Group: click to select all ${members.length}"><span data-toggle-group="${esc(inst.group)}" class="scene-group-toggle">${open ? '▾' : '▸'}</span><span class="scene-row-name">${esc(inst.group)}</span><span class="part-tag">${members.length} · group</span></button>`);
        if (open) for (const member of members) out.push(row(member, true));
      }
      return out.join('');
    });
  }

  renderLibrary() {
    const c = this.composer;
    const filter = this.getFilter().trim().toLowerCase();
    const list = this.library.filter((a) => !filter || `${a.slug} ${a.title} ${a.set || ''} ${a.category}`.toLowerCase().includes(filter));
    const placing = c.placing?.slug || null;
    const changed = this.section('sceneLibrary', JSON.stringify([list.map((a) => [a.slug, a.thumb, a.glbHash, a.built]), placing, c.active]), () => {
      if (!c.active) return '';
      const bySet = new Map();
      for (const a of list) {
        const key = a.set || '';
        if (!bySet.has(key)) bySet.set(key, []);
        bySet.get(key).push(a);
      }
      const keys = [...bySet.keys()].sort((x, y) => (x === '' ? 1 : y === '' ? -1 : x.localeCompare(y)));
      const out = ['<div class="group-title">Library · click, then click in the room</div>'];
      if (!list.length) out.push('<p class="muted">No asset matches the filter.</p>');
      for (const key of keys) {
        out.push(`<div class="group-title">${key ? `Set · ${esc(key)}` : 'Assets'}</div><div class="library-grid">`);
        for (const a of bySet.get(key)) {
          out.push(`<button type="button" class="library-card ${a.slug === placing ? 'on' : ''}" data-place="${esc(a.slug)}" ${a.broken ? 'disabled' : ''} title="${esc(a.title)} · ${esc(a.slug)}">${this.thumbs.html(a.slug, a)}<span class="library-name">${esc(a.title)}</span><span class="library-size">${a.broken ? 'broken' : sizeText(a.size?.meters)}</span></button>`);
        }
        out.push('</div>');
      }
      return out.join('');
    });
    if (changed) this.thumbs.observe($('sceneLibrary'));
  }

  renderToolbar() {
    const c = this.composer;
    for (const button of document.querySelectorAll('[data-scene-mode]')) {
      button.classList.toggle('on', button.dataset.sceneMode === c.mode);
      button.disabled = !c.doc || (button.dataset.sceneMode !== 'select' && !c.movable().length);
    }
    $('sceneGrid').value = String(c.snap.grid);
    for (const [id, on, label] of [['sceneWallSnap', c.snap.wall, 'Wall snap'], ['sceneStack', c.snap.stack, 'Stack'], ['scenePlan', c.plan, 'Plan view'], ['sceneCeiling', c.showCeiling, 'Ceiling']]) {
      $(id).classList.toggle('on', !!on);
      $(id).setAttribute('aria-pressed', String(!!on));
      $(id).textContent = label;
    }
    $('sceneWallSnap').disabled = !c.doc?.room;
    $('sceneCeiling').disabled = !c.doc?.room?.ceiling;
    const hint = $('sceneHint');
    const title = c.placing ? this.libraryBySlug.get(c.placing.slug)?.title || c.placing.slug : null;
    hint.classList.toggle('hidden', !c.placing);
    hint.textContent = !c.placing ? '' : c.placing.ghost ? `Placing ${title}: click to drop · Shift+click keeps placing · R turns · Esc cancels` : `Loading ${title}…`;
    $('sceneUndo').disabled = !c.undoStack.length || c.saveState === 'conflict';
    $('sceneRedo').disabled = !c.redoStack.length || c.saveState === 'conflict';
    $('sceneSaveBtn').disabled = !c.doc || c.saveState === 'conflict';
    $('sceneExportBtn').disabled = !c.doc || c.saveState === 'conflict' || !!c.exportResult?.pending;
  }

  renderStatus() {
    const c = this.composer;
    const node = $('sceneStatus');
    const state = c.saveState;
    const text = !c.doc ? 'No scene loaded'
      : state === 'conflict' ? 'Conflict: the scene changed on disk'
        : state === 'error' ? 'Autosave failed'
          : state === 'saving' || state === 'pending' ? 'Saving…'
            : c.loadingItems ? `Loading ${c.loadingItems} asset(s)…`
              : `Autosaved${c.history?.current ? ` · equals ${c.history.current}` : c.versions.length ? ' · changes since the last version' : ' · no version saved yet'}`;
    node.textContent = text;
    node.className = `edit-status ${state === 'saved' && !c.loadingItems ? 'ok' : state === 'conflict' || state === 'error' ? 'error' : 'pending'}`;
  }

  renderAlert() {
    const c = this.composer;
    const node = $('sceneAlert');
    const alert = c.alert;
    const signature = alert ? `${alert.message}|${Object.keys(alert.actions).join(',')}` : '';
    if (this.signatures.sceneAlert === signature) return;
    this.signatures.sceneAlert = signature;
    node.classList.toggle('hidden', !alert);
    node.innerHTML = alert ? `<div>${esc(alert.message)}</div>${Object.keys(alert.actions).map((label) => `<button type="button" data-alert-action="${esc(label)}">${esc(label)}</button>`).join('')}<button type="button" data-alert-action="">Dismiss</button>` : '';
  }

  /** Inspector for several selected instances: what is selected, and what can be done to all of it. */
  multiInspector(selected) {
    const c = this.composer;
    const counts = new Map();
    for (const inst of selected) counts.set(inst.asset, (counts.get(inst.asset) || 0) + 1);
    const box = c.selectionBox();
    const size = box ? [box.max[0] - box.min[0], box.max[2] - box.min[2], box.max[1] - box.min[1]] : null;
    const groups = new Set(selected.map((inst) => inst.group || ''));
    const group = groups.size === 1 ? [...groups][0] : null;
    const locked = selected.filter((inst) => inst.locked).length;
    const movable = selected.length - locked;
    return `
      <h3>Selection · ${selected.length} instances</h3>
      <div class="kv">
        <div>Assets</div><div>${[...counts].map(([asset, n]) => `${n} × ${esc(this.libraryBySlug.get(asset)?.title || asset)}`).join('<br>')}</div>
        <div>Block size</div><div>${size ? `${size[0].toFixed(2)} × ${size[1].toFixed(2)} × ${size[2].toFixed(2)} m<br><span class="muted">${size.map((v) => (v / STUD).toFixed(1)).join(' × ')} studs (W × D × H)</span>` : '—'}</div>
        <div>Group</div><div>${group ? `<input type="text" data-group-name="${esc(group)}" value="${esc(group)}" maxlength="60" aria-label="Group name">` : group === '' ? '<span class="muted">not grouped</span>' : '<span class="muted">mixed</span>'}</div>
      </div>
      <p class="edit-help">Move and Turn act on the whole block (arrow keys nudge it one grid step). ${locked ? `${locked} locked instance(s) stay where they are.` : ''}</p>
      <div class="scene-actions-row">
        <button type="button" data-inst-action="rotate-left" ${movable ? '' : 'disabled'} title="Turn the block 90° left">⟲ 90°</button>
        <button type="button" data-inst-action="rotate-right" ${movable ? '' : 'disabled'} title="Turn the block 90° right (R)">⟳ 90°</button>
        <button type="button" data-inst-action="drop" ${movable ? '' : 'disabled'} title="Rest each on the surface below">Drop</button>
        <button type="button" data-inst-action="duplicate" title="Duplicate (Ctrl/⌘ D)">Duplicate</button>
        <button type="button" data-inst-action="focus" title="Frame it (F)">Focus</button>
        <button type="button" data-inst-action="delete" title="Delete (Del)">Delete</button>
      </div>
      <div class="scene-actions-row">
        <button type="button" data-inst-action="group" ${group ? 'disabled' : ''} title="Make these one unit (Ctrl/⌘ G)">Group</button>
        <button type="button" data-inst-action="ungroup" ${selected.some((inst) => inst.group) ? '' : 'disabled'} title="Ctrl/⌘ Shift G">Ungroup</button>
        <button type="button" data-inst-action="${locked === selected.length ? 'unlock' : 'lock'}">${locked === selected.length ? 'Unlock all' : 'Lock all'}</button>
      </div>`;
  }

  renderInspector() {
    const c = this.composer;
    const many = c.selectedInstances();
    if (many.length > 1) {
      this.section('sceneInspector', JSON.stringify(['multi', many, c.selectionBox()]), () => this.multiInspector(many));
      return;
    }
    const inst = c.selectedInstance();
    const entry = inst ? c.itemOf(inst) : null;
    const lib = inst ? this.libraryBySlug.get(inst.asset) : null;
    this.section('sceneInspector', JSON.stringify([inst, entry?.info?.meters, entry?.info?.error, lib?.variants, lib?.skins, !!c.doc]), () => {
      if (!c.doc) return '';
      if (!inst) return '<h3>Instance</h3><p class="muted">Select a placed asset to move, turn or replace it. Assets keep their real size: there is no scale.</p>';
      const meters = entry?.info?.meters;
      const options = (list, current, base) => [`<option value="">${base}</option>`, ...list.map((v) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`)].join('');
      const axis = (label, index) => `<label>${label}<input type="number" step="0.01" data-inst-pos="${index}" value="${fmt(inst.position[index], 4)}" ${inst.locked ? 'disabled' : ''}><span class="unit">m</span></label>`;
      return `
        <h3>Instance · ${esc(inst.id)}</h3>
        ${entry?.info?.error ? `<div class="edit-alert">${esc(entry.info.error)}</div>` : ''}
        <div class="kv">
          <div>Asset</div><div>${esc(lib?.title || inst.asset)}<br><span class="muted">${esc(inst.asset)}</span></div>
          <div>Real size</div><div>${meters ? `${sizeText(meters)}<br><span class="muted">${meters.map((v) => (v / STUD).toFixed(1)).join(' × ')} studs (W × H × D)</span>` : '—'}</div>
        </div>
        <div class="edit-control"><div class="edit-control-head"><label for="sceneInstName">Label</label></div>
          <div class="edit-control-row"><input id="sceneInstName" type="text" maxlength="80" data-inst-field="name" value="${esc(inst.name || '')}" placeholder="${esc(inst.id)}"></div></div>
        ${lib?.variants?.length ? `<div class="edit-control"><div class="edit-control-head"><label for="sceneInstVariant">Variant</label></div><div class="edit-control-row"><select id="sceneInstVariant" data-inst-field="variant">${options(lib.variants, inst.variant, 'base')}</select></div></div>` : ''}
        ${lib?.skins?.length ? `<div class="edit-control"><div class="edit-control-head"><label for="sceneInstSkin">Skin</label></div><div class="edit-control-row"><select id="sceneInstSkin" data-inst-field="skin">${options(lib.skins, inst.skin, 'default')}</select></div></div>` : ''}
        <div class="part-transform-row"><div class="edit-control-head"><label>Position</label></div><div class="part-axis-fields">${axis('X', 0)}${axis('Y', 1)}${axis('Z', 2)}</div></div>
        <div class="part-transform-row"><div class="edit-control-head"><label for="sceneInstYaw">Turn</label></div>
          <div class="part-axis-fields"><label>Yaw<input id="sceneInstYaw" type="number" step="15" data-inst-field="yaw" value="${fmt(inst.yaw, 2)}" ${inst.locked ? 'disabled' : ''}><span class="unit">°</span></label>
          <button type="button" data-inst-action="rotate-left" ${inst.locked ? 'disabled' : ''} title="Turn 90° left">⟲ 90°</button><button type="button" data-inst-action="rotate-right" ${inst.locked ? 'disabled' : ''} title="Turn 90° right (R)">⟳ 90°</button></div></div>
        <div class="scene-actions-row">
          <button type="button" data-inst-action="drop" ${inst.locked ? 'disabled' : ''} title="Rest on the surface below (asset or floor)">Drop</button>
          <button type="button" data-inst-action="duplicate" title="Duplicate (Ctrl/⌘ D)">Duplicate</button>
          <button type="button" data-inst-action="focus" title="Frame it (F)">Focus</button>
          <button type="button" data-inst-action="delete" title="Delete (Del)">Delete</button>
          <label class="scene-check"><input type="checkbox" data-inst-field="locked" ${inst.locked ? 'checked' : ''}> Lock</label>
        </div>
        ${inst.group ? `<p class="edit-help">Part of group <strong>${esc(inst.group)}</strong>. <button type="button" class="reset-edit" data-inst-action="select-group">Select the group</button></p>` : ''}`;
    });
  }

  /** Array panel: repeat the selection on a grid (rows of shelves, blocks of tables). */
  renderArray() {
    const c = this.composer;
    const key = c.selection.slice().sort().join(',');
    if (key !== this.arrayFor) {
      this.arrayFor = key;
      this.array.dx = null;
      this.array.dz = null;
      this.signatures.sceneArray = null;
    }
    const box = c.selectionBox();
    this.section('sceneArray', JSON.stringify([key, this.array, box, !!c.doc]), () => {
      if (!c.doc || !box) return '';
      const a = this.array;
      const dx = a.dx ?? +(box.max[0] - box.min[0]).toFixed(3);
      const dz = a.dz ?? +(box.max[2] - box.min[2]).toFixed(3);
      const cells = Math.max(1, a.columns) * Math.max(1, a.rows);
      const count = c.selection.length;
      return `
        <h3>Array</h3>
        <div class="part-axis-fields">
          <label>Columns<input type="number" min="1" max="50" step="1" data-array="columns" value="${a.columns}"></label>
          <label>every<input type="number" step="0.05" data-array="dx" value="${fmt(dx, 3)}"><span class="unit">m</span></label>
        </div>
        <div class="part-axis-fields">
          <label>Rows<input type="number" min="1" max="50" step="1" data-array="rows" value="${a.rows}"></label>
          <label>every<input type="number" step="0.05" data-array="dz" value="${fmt(dz, 3)}"><span class="unit">m</span></label>
        </div>
        <p class="edit-help">Columns run along X, rows along Z. The spacing starts at the selection's own size, so the copies touch: add your aisle width to it.</p>
        <div class="scene-actions-row"><button type="button" data-array-create ${cells < 2 ? 'disabled' : ''}>Create ${cells} × ${count} = ${cells * count} instances</button></div>`;
    });
  }

  arraySpec() {
    const box = this.composer.selectionBox();
    const a = this.array;
    return { columns: a.columns, rows: a.rows, dx: a.dx ?? +(box.max[0] - box.min[0]).toFixed(3), dz: a.dz ?? +(box.max[2] - box.min[2]).toFixed(3) };
  }

  renderRoom() {
    const c = this.composer;
    const room = c.doc?.room;
    this.section('sceneRoom', JSON.stringify([room, !!c.doc]), () => {
      if (!c.doc) return '';
      if (!room) return '<h3>Room</h3><p class="muted">This scene has no room shell: only the placed assets are exported.</p><button type="button" data-room-action="add">Add a room (6 × 4 × 3 m)</button>';
      const num = (key, label, step = 0.1) => `<label>${label}<input type="number" step="${step}" data-room-field="${key}" value="${fmt(room[key], 3)}"><span class="unit">m</span></label>`;
      const finish = (zone, label) => `<div class="edit-control-row scene-finish"><span class="scene-finish-label">${label}</span><select data-finish-zone="${zone}" data-finish-key="kind">${FINISH_KINDS.map((k) => `<option ${k === room.finishes[zone].kind ? 'selected' : ''}>${k}</option>`).join('')}</select><input type="color" data-finish-zone="${zone}" data-finish-key="color" value="${esc(room.finishes[zone].color)}" aria-label="${label} color"></div>`;
      const opening = (o, i) => `
        <div class="scene-opening">
          <div class="edit-control-row"><strong>${o.y > 0 ? 'Window' : 'Door'}</strong><select data-opening="${i}" data-opening-key="wall" aria-label="Wall">${WALLS.map((w) => `<option value="${w}" ${w === o.wall ? 'selected' : ''}>${WALL_LABEL[w]}</option>`).join('')}</select><select data-opening="${i}" data-opening-key="shape" aria-label="Shape"><option ${o.shape === 'rect' ? 'selected' : ''}>rect</option><option ${o.shape === 'arch' ? 'selected' : ''}>arch</option></select><button type="button" data-room-action="remove-opening" data-index="${i}" title="Remove this opening">✕</button></div>
          <div class="part-axis-fields">${[['offset', 'Offset'], ['y', 'Sill'], ['w', 'W'], ['h', 'H']].map(([key, label]) => `<label>${label}<input type="number" step="0.05" data-opening="${i}" data-opening-key="${key}" value="${fmt(o[key], 3)}"></label>`).join('')}</div>
        </div>`;
      return `
        <h3>Room</h3>
        <div class="part-axis-fields">${num('width', 'W')}${num('depth', 'D')}${num('height', 'H')}</div>
        <p class="edit-help">${(room.width / STUD).toFixed(1)} × ${(room.depth / STUD).toFixed(1)} × ${(room.height / STUD).toFixed(1)} studs inside. Offsets run along the wall from its middle.</p>
        <div class="part-axis-fields">${num('wallThickness', 'Wall', 0.01)}<label class="scene-check"><input type="checkbox" data-room-field="ceiling" ${room.ceiling ? 'checked' : ''}> Ceiling</label></div>
        <h3>Finishes</h3>${finish('wall', 'Walls')}${finish('floor', 'Floor')}${finish('ceiling', 'Ceiling')}
        <h3>Openings · ${room.openings.length}</h3>${room.openings.map(opening).join('')}
        <div class="scene-actions-row"><button type="button" data-room-action="add-door">Add door</button><button type="button" data-room-action="add-window">Add window</button><button type="button" data-room-action="remove">Remove room</button></div>`;
    });
  }

  renderReport() {
    const c = this.composer;
    const r = c.report;
    this.section('sceneReportBox', JSON.stringify([r?.hashes?.compose, r?.profile?.id, c.reportPending && !r, !!c.doc]), () => {
      if (!c.doc) return '';
      if (!r) return `<h3>Scene report</h3><p class="muted">${c.reportPending ? 'Checking the scene…' : 'No report yet.'}</p>`;
      const status = r.ok ? '<span style="color:var(--ok)">ready to export</span>' : `<span style="color:var(--err)">${r.counts.error} error(s) block export</span>`;
      const issues = r.issues.filter((i) => i.severity !== 'info');
      return `
        <h3>Scene report · ${esc(r.profile.label)}</h3>
        <div class="kv">
          <div>Status</div><div>${status} · ${r.counts.warning} warnings</div>
          <div>Size</div><div>${r.dimensions.meters.map((v) => v.toFixed(2)).join(' × ')} m<br><span class="muted">${r.dimensions.studs.join(' × ')} studs</span></div>
          <div>Triangles</div><div>${r.triangles.total.toLocaleString()}${r.triangles.room ? ` <span class="muted">(room ${r.triangles.room.toLocaleString()})</span>` : ''}</div>
          <div>Meshes</div><div>${r.meshCount}</div>
          <div>Instances</div><div>${r.instanceCount} of ${r.items.length} asset(s)</div>
        </div>
        ${issues.map((i) => `<div class="issue ${i.severity}"><div>${esc(i.message)}</div><div class="id">${i.severity} · ${i.id}</div>${i.hint ? `<div class="hint">Fix: ${esc(i.hint)}</div>` : ''}</div>`).join('')}
        ${r.items.length ? `<table><tr><th>Asset</th><th class="num">×</th><th class="num">Tris each</th></tr>${r.items.map((it) => `<tr><td>${esc(it.item)}${it.problem ? ` <span style="color:var(--err)">${esc(it.problem)}</span>` : ''}</td><td class="num">${it.count}</td><td class="num">${it.triangles?.toLocaleString() ?? '—'}</td></tr>`).join('')}</table>` : ''}`;
    });
  }

  renderVersions() {
    const c = this.composer;
    this.section('sceneVersions', JSON.stringify([c.versions, c.history?.current, !!c.doc]), () => {
      if (!c.doc) return '';
      if (!c.versions.length) return '<h3>Versions</h3><p class="muted">No saved versions yet. Edits autosave to scene.json; Save Version keeps a checkpoint you can return to.</p>';
      return `<h3>Versions</h3>${c.versions.slice().reverse().map((v) => `
        <div class="scene-version ${v.id === c.history?.current ? 'on' : ''}"><div><span class="v">${v.id}</span>${v.auto ? ' <span class="muted">auto</span>' : ''} ${esc(v.note || '')}<div class="muted">${new Date(v.createdAt).toLocaleString()} · ${v.instances} instance(s)</div></div>
        <button type="button" data-restore-version="${v.id}" ${v.id === c.history?.current ? 'disabled' : ''}>Restore</button></div>`).join('')}`;
    });
  }

  renderExport() {
    const c = this.composer;
    const node = $('sceneExportResult');
    const r = c.exportResult;
    const signature = JSON.stringify(r || null);
    if (this.signatures.sceneExportResult === signature) return;
    this.signatures.sceneExportResult = signature;
    node.classList.toggle('hidden', !r);
    if (!r) node.innerHTML = '';
    else if (r.pending) node.innerHTML = '<p class="muted">Exporting…</p>';
    else if (r.blocked) node.innerHTML = `<div class="edit-alert">Export blocked: ${esc(r.reason)}${(r.errors || []).map((e) => `<div>${esc(e.id)}: ${esc(e.message)}</div>`).join('')}</div>`;
    else {
      const link = (file, label) => `<a href="/files/exports/${file.split('exports/').pop()}" target="_blank" rel="noopener">${label}</a>`;
      node.innerHTML = `<p style="color:var(--ok)">Exported for ${esc(r.profile)}:</p><p><code>${esc(r.files.glb)}</code></p>${link(r.files.glb, 'GLB')}${link(r.files.md, 'Import steps')}${link(r.files.layout, 'Layout JSON')}`;
    }
  }

  // ---------------------------------------------------------------- events

  bind() {
    const c = this.composer;
    $('sceneSelect').addEventListener('change', (event) => this.onEnter(event.target.value || null));
    $('sceneNew').addEventListener('click', () => {
      $('sceneNewForm').classList.toggle('hidden');
      if (!$('sceneNewForm').classList.contains('hidden')) $('sceneNewName').focus();
    });
    $('sceneNewCancel').addEventListener('click', () => $('sceneNewForm').classList.add('hidden'));
    $('sceneNewForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = $('sceneNewName').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const room = { width: Number($('sceneNewW').value), depth: Number($('sceneNewD').value), height: Number($('sceneNewH').value) };
      const res = await fetch('/api/scene/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, title: $('sceneNewName').value.trim(), room }) });
      const body = await res.json();
      const error = $('sceneNewError');
      error.textContent = res.ok ? '' : body.error || 'Could not create the scene.';
      if (!res.ok) return;
      $('sceneNewForm').classList.add('hidden');
      $('sceneNewName').value = '';
      await this.refreshScenes();
      this.onEnter(name);
    });

    $('sceneOutliner').addEventListener('click', (event) => {
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const toggle = event.target.closest('[data-toggle-group]');
      if (toggle) {
        const group = toggle.dataset.toggleGroup;
        if (this.collapsedGroups.has(group)) this.collapsedGroups.delete(group);
        else this.collapsedGroups.add(group);
        this.render();
        return;
      }
      const header = event.target.closest('[data-group]');
      if (header) {
        c.selectMany(c.doc.instances.filter((inst) => inst.group === header.dataset.group).map((inst) => inst.id), { additive });
        return;
      }
      // A row picks exactly that instance, also inside a group.
      const row = event.target.closest('[data-instance]');
      if (row) c.select(row.dataset.instance, { additive, single: true });
    });
    $('sceneOutliner').addEventListener('dblclick', (event) => {
      if (event.target.closest('[data-instance]')) c.focusSelected();
    });
    $('sceneLibrary').addEventListener('click', (event) => {
      const card = event.target.closest('[data-place]');
      if (!card || card.disabled) return;
      if (c.placing?.slug === card.dataset.place) c.cancelPlacing();
      else c.startPlacing({ slug: card.dataset.place });
    });

    document.querySelectorAll('[data-scene-mode]').forEach((button) => button.addEventListener('click', () => c.setMode(button.dataset.sceneMode)));
    $('sceneGrid').addEventListener('change', (event) => c.setSnap({ grid: Number(event.target.value) }));
    $('sceneWallSnap').addEventListener('click', () => c.setSnap({ wall: !c.snap.wall }));
    $('sceneStack').addEventListener('click', () => c.setSnap({ stack: !c.snap.stack }));
    $('scenePlan').addEventListener('click', () => c.setPlan(!c.plan));
    $('sceneCeiling').addEventListener('click', () => { c.showCeiling = !c.showCeiling; this.render(); });
    $('sceneUndo').addEventListener('click', () => c.undo());
    $('sceneRedo').addEventListener('click', () => c.redo());
    $('sceneExportBtn').addEventListener('click', () => c.exportScene());
    $('sceneSaveBtn').addEventListener('click', () => this.openSaveForm());
    $('sceneSaveCancel').addEventListener('click', () => $('sceneSaveForm').classList.add('hidden'));
    $('sceneSaveForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const note = $('sceneNote').value.trim();
      if (!note) return;
      if (await c.saveVersion(note)) {
        $('sceneNote').value = '';
        $('sceneSaveForm').classList.add('hidden');
      }
    });

    $('sceneAlert').addEventListener('click', (event) => {
      const button = event.target.closest('[data-alert-action]');
      if (!button) return;
      const action = c.alert?.actions?.[button.dataset.alertAction];
      if (action) action();
      else c.setAlert(null);
    });

    $('sceneArray').addEventListener('change', (event) => {
      const key = event.target.dataset.array;
      if (!key) return;
      const value = Number(event.target.value);
      if (Number.isFinite(value) && event.target.value !== '') {
        if (key === 'columns' || key === 'rows') this.array[key] = Math.min(50, Math.max(1, Math.round(value)));
        else this.array[key] = value;
      }
      this.rerender('sceneArray');
    });
    $('sceneArray').addEventListener('click', (event) => {
      if (!event.target.closest('[data-array-create]')) return;
      c.arraySelection(this.arraySpec());
      // The result is selected now: start over, so a second click cannot multiply it again.
      this.array = { columns: 1, rows: 1, dx: null, dz: null };
      this.rerender('sceneArray');
    });

    $('sceneInspector').addEventListener('change', (event) => {
      const inst = c.selectedInstance();
      const target = event.target;
      if (target.dataset.groupName !== undefined) {
        const name = target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (name) c.renameGroup(target.dataset.groupName, name);
        return this.rerender('sceneInspector');
      }
      if (!inst || c.selection.length > 1) return;
      if (target.dataset.instPos !== undefined) {
        const value = Number(target.value);
        if (!Number.isFinite(value) || target.value === '') return this.rerender('sceneInspector');
        const position = [...inst.position];
        position[Number(target.dataset.instPos)] = value;
        c.updateInstance(inst.id, { position });
      } else if (target.dataset.instField === 'yaw') {
        const value = Number(target.value);
        if (!Number.isFinite(value) || target.value === '') return this.rerender('sceneInspector');
        c.updateInstance(inst.id, { yaw: ((value % 360) + 360) % 360 });
      } else if (target.dataset.instField === 'locked') c.updateInstance(inst.id, { locked: target.checked });
      else if (target.dataset.instField === 'name') c.updateInstance(inst.id, { name: target.value.trim() });
      else if (target.dataset.instField === 'variant') c.updateInstance(inst.id, { variant: target.value || null });
      else if (target.dataset.instField === 'skin') c.updateInstance(inst.id, { skin: target.value || null });
      this.rerender('sceneInspector');
    });
    $('sceneInspector').addEventListener('click', (event) => {
      const action = event.target.closest('[data-inst-action]')?.dataset.instAction;
      if (action === 'rotate-left') c.rotateSelected(90);
      else if (action === 'rotate-right') c.rotateSelected(-90);
      else if (action === 'drop') c.dropSelected();
      else if (action === 'duplicate') c.duplicateSelected();
      else if (action === 'focus') c.focusSelected();
      else if (action === 'delete') c.deleteSelected();
      else if (action === 'group') c.groupSelection();
      else if (action === 'ungroup') c.ungroupSelection();
      else if (action === 'lock') c.setLockedSelected(true);
      else if (action === 'unlock') c.setLockedSelected(false);
      else if (action === 'select-group' && c.selected) c.select(c.selected);
      if (action) this.rerender('sceneInspector');
    });

    $('sceneRoom').addEventListener('change', (event) => {
      const target = event.target;
      const numberOf = () => {
        const value = Number(target.value);
        return Number.isFinite(value) && target.value !== '' ? value : null;
      };
      if (target.dataset.roomField === 'ceiling') c.updateRoom({ ceiling: target.checked });
      else if (target.dataset.roomField) {
        const value = numberOf();
        if (value !== null) c.updateRoom({ [target.dataset.roomField]: value });
      } else if (target.dataset.finishZone) {
        const room = c.doc.room;
        c.updateRoom({ finishes: { ...room.finishes, [target.dataset.finishZone]: { ...room.finishes[target.dataset.finishZone], [target.dataset.finishKey]: target.value } } });
      } else if (target.dataset.opening !== undefined) {
        const key = target.dataset.openingKey;
        const value = key === 'wall' || key === 'shape' ? target.value : numberOf();
        if (value !== null) c.updateOpening(Number(target.dataset.opening), { [key]: value });
      }
      this.rerender('sceneRoom');
    });
    $('sceneRoom').addEventListener('click', (event) => {
      const button = event.target.closest('[data-room-action]');
      if (!button) return;
      const action = button.dataset.roomAction;
      if (action === 'add') c.setRoom({ width: 6, depth: 4, height: 3, wallThickness: 0.2, ceiling: true, openings: [], finishes: { wall: { kind: 'plaster', color: '#e6e2d8' }, floor: { kind: 'concrete', color: '#b9b5ad' }, ceiling: { kind: 'plaster', color: '#f2f0ea' } } });
      else if (action === 'remove') c.setRoom(null);
      else if (action === 'add-door') c.addOpening('door');
      else if (action === 'add-window') c.addOpening('window');
      else if (action === 'remove-opening') c.removeOpening(Number(button.dataset.index));
      this.rerender('sceneRoom');
    });
    $('sceneVersions').addEventListener('click', (event) => {
      const button = event.target.closest('[data-restore-version]');
      if (button) c.restoreVersion(button.dataset.restoreVersion);
    });
  }

  /** Re-render a form section even though it has focus (after its own change event). */
  rerender(id) {
    this.signatures[id] = null;
    this.render();
  }

  openSaveForm() {
    $('sceneSaveForm').classList.remove('hidden');
    $('sceneNote').focus();
  }
}
