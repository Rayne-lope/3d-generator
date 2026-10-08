// Working-copy inspector. Committed values always rebuild the exported GLB.

import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const copy = (object) => ({ ...(object || {}) });
const clone = (value) => JSON.parse(JSON.stringify(value));
const IDENTITY = { move: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 };
const recoveryKey = (slug, scope) => `studio.editor.recovery.${slug}.${scope}`;
const draftKey = (slug, scope) => `studio.editor.draft.${slug}.${scope}`;

async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function post(path, body, method = 'POST') {
  return request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function scaleFor(control) { return control.displayUnit === 'cm' ? 100 : 1; }
function formatNumber(value, control) {
  const factor = scaleFor(control);
  const step = (control.step || 0.01) * factor;
  const places = Math.min(4, String(step).split('.')[1]?.length || 0);
  return Number((Number(value) * factor).toFixed(places));
}

function scopeFor(context) { return context.variant ? `variant:${context.variant}` : 'base'; }
function exportHref(file, profile) {
  const name = String(file).split(/[\\/]/).at(-1);
  return `/files/exports/${encodeURIComponent(profile)}/${encodeURIComponent(name)}`;
}

function controlsMarkup(snapshot, readOnly) {
  const groups = new Map();
  for (const control of snapshot.controls || []) {
    const name = snapshot.groups?.find((group) => group.id === control.group)?.label || control.group || 'Parameters';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(control);
  }
  return [...groups].map(([name, controls]) => `
    <section class="edit-group" aria-label="${esc(name)}">
      <h3>${esc(name)}</h3>
      ${controls.map((control) => controlMarkup(control, snapshot, readOnly)).join('')}
    </section>`).join('');
}

function partMarkup(snapshot, id, readOnly, stats = null) {
  const part = snapshot.parts?.find((item) => item.id === id);
  if (!part) return '<p class="muted">Select a part from the left panel or viewport.</p>';
  const value = snapshot.partTransforms?.effective?.[id] || IDENTITY;
  const scope = snapshot.variant ? snapshot.partTransforms?.overrides?.variants?.[snapshot.variant] : snapshot.partTransforms?.overrides?.base;
  const baseline = snapshot.partTransforms?.baseline?.[id] || IDENTITY;
  const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...value.rotation), 'XYZ');
  const degrees = [rotation.x, rotation.y, rotation.z].map((v) => +(v * 180 / Math.PI).toFixed(1));
  const rows = [
    { field: 'move', label: 'Move', axes: 'XYZ', values: value.move.map((v) => +(v * 100).toFixed(2)), unit: 'cm', min: -200, max: 200, step: 1 },
    { field: 'rotation', label: 'Rotate', axes: 'XYZ', values: degrees, unit: '°', min: -180, max: 180, step: 1 },
    { field: 'scale', label: 'Uniform scale', axes: '', values: [+(value.scale * 100).toFixed(2)], unit: '%', min: 25, max: 400, step: 1 },
  ];
  const disabled = readOnly || !part.editable ? ' disabled' : '';
  const origin = snapshot.partTransforms?.origins?.[id] || 'default';
  return `<section class="edit-group part-inspector" data-part="${esc(id)}" aria-label="${esc(part.label)} transform">
    <h3>${esc(part.label)} <span class="edit-origin">${esc(origin === 'saved' ? 'Saved version' : origin === 'variant-edit' ? 'Variant edit' : origin === 'base' ? 'Base edit' : 'Authored')}</span></h3>
    ${part.reason ? `<p class="note">${esc(part.reason)}</p>` : ''}
    <p class="edit-help">Local transform relative to authored ${esc(snapshot.variant || 'base')} pose. Move uses source centimeters.</p>
    ${stats ? `<p class="edit-help">Exported subtree: ${stats.triangles.toLocaleString()} triangles · ${stats.materials.length} material${stats.materials.length === 1 ? '' : 's'}${stats.materials.length ? ` (${esc(stats.materials.join(', '))})` : ''}.</p>` : ''}
    ${rows.map((row) => { const fieldDisabled = disabled || !part.transform?.[row.field === 'rotation' ? 'rotate' : row.field] ? ' disabled' : ''; return `<div class="part-transform-row"><div class="edit-control-head"><span>${row.label}</span><button type="button" class="reset-edit" data-reset-part-field="${row.field}" data-part-id="${esc(id)}"${fieldDisabled}>Reset</button></div><div class="part-axis-fields">${row.values.map((number, axis) => `<label>${row.axes[axis] || 'All'} <input type="number" data-part-id="${esc(id)}" data-part-field="${row.field}" data-part-axis="${axis}" value="${number}" min="${row.min}" max="${row.max}" step="${row.step}" aria-describedby="part-error-${esc(id)}"${fieldDisabled}> <span class="unit">${row.unit}</span></label>`).join('')}</div></div>`; }).join('')}
    <p class="edit-error hidden" id="part-error-${esc(id)}" data-part-error="${esc(id)}"></p>
    ${has(scope, id) ? `<button type="button" class="reset-edit" data-reset-part="${esc(id)}"${disabled}>Reset transform override</button>` : ''}
    <p class="edit-help">Pivot: ${part.pivot?.map((n) => `${+(n * 100).toFixed(1)} cm`).join(', ') || '—'}. Baseline scale ${Math.round(baseline.scale * 100)}%.</p>
  </section>`;
}

function controlMarkup(control, snapshot, readOnly) {
  const key = control.key;
  const value = snapshot.effective?.[key];
  const origin = snapshot.origins?.[key] || 'default';
  const scope = snapshot.variant ? snapshot.overrides?.variants?.[snapshot.variant] : snapshot.overrides?.base;
  const edited = has(scope, key);
  const disabled = readOnly ? ' disabled' : '';
  const id = `edit-${key}`;
  const describedBy = `${control.help ? `edit-help-${key} ` : ''}edit-error-${key}`;
  const label = `<label for="${id}">${esc(control.label || key)}</label>`;
  const reset = edited && !readOnly ? `<button type="button" class="reset-edit" data-reset="${esc(key)}" title="Remove this edit and reveal its authored value">Reset override</button>` : `<span class="edit-origin">${esc(origin === 'skin' ? 'Skin preset' : origin === 'variant' ? 'Variant preset' : origin === 'base' ? 'Base edit' : origin === 'variant-edit' ? 'Variant edit' : 'Default')}</span>`;
  let input = '';
  if (control.type === 'number' || control.type === 'integer') {
    const factor = scaleFor(control);
    const min = Number(control.min) * factor;
    const max = Number(control.max) * factor;
    const step = (control.step || (control.type === 'integer' ? 1 : 0.01)) * factor;
    const shown = formatNumber(value, control);
    input = `<input id="${id}" data-key="${esc(key)}" data-role="number" type="number" value="${shown}" min="${min}" max="${max}" step="${step}" aria-describedby="${describedBy}"${disabled}>
      ${control.displayUnit || control.unit ? `<span class="unit">${esc(control.displayUnit || control.unit)}</span>` : ''}
      <input data-key="${esc(key)}" data-role="range" type="range" aria-label="${esc(control.label || key)} slider" value="${shown}" min="${min}" max="${max}" step="${step}"${disabled}>`;
  } else if (control.type === 'color') {
    input = `<input id="${id}" data-key="${esc(key)}" data-role="color" type="color" value="${esc(value)}" aria-describedby="${describedBy}"${disabled}>
      <input data-key="${esc(key)}" data-role="hex" type="text" value="${esc(value)}" maxlength="7" inputmode="text" aria-label="${esc(control.label || key)} hex color" aria-describedby="${describedBy}" spellcheck="false"${disabled}>`;
  } else if (control.type === 'boolean') {
    input = `<input id="${id}" data-key="${esc(key)}" data-role="boolean" type="checkbox" aria-describedby="${describedBy}"${value ? ' checked' : ''}${disabled}>`;
  } else if (control.type === 'select') {
    input = `<select id="${id}" data-key="${esc(key)}" data-role="select" aria-describedby="${describedBy}"${disabled}>${(control.options || []).map((option) => {
      const val = typeof option === 'object' ? option.value : option;
      const text = typeof option === 'object' ? option.label : option;
      return `<option value="${esc(val)}"${val === value ? ' selected' : ''}>${esc(text)}</option>`;
    }).join('')}</select>`;
  }
  return `<div class="edit-control" data-control="${esc(key)}">
    <div class="edit-control-head">${label}${reset}</div>
    <div class="edit-control-row">${input}</div>
    ${control.help ? `<p class="edit-help" id="edit-help-${esc(key)}">${esc(control.help)}</p>` : ''}
    <p class="edit-error hidden" id="edit-error-${esc(key)}" data-error="${esc(key)}"></p>
  </div>`;
}

export class EditorController {
  constructor({ onBuild, onRestore, onSave, onPreviewHistory, onStateChange, onDiscardDraft }) {
    this.onBuild = onBuild;
    this.onRestore = onRestore;
    this.onSave = onSave;
    this.onPreviewHistory = onPreviewHistory;
    this.onStateChange = onStateChange;
    this.onDiscardDraft = onDiscardDraft;
    this.context = null;
    this.snapshot = null;
    this.report = null;
    this.previewError = null;
    this.previewPending = false;
    this.mutationBusy = false;
    this.generation = 0;
    this.stacks = new Map();
    this.pendingAction = null;
    this.queuedActions = [];
    this.openSaveWhenFresh = false;
    this.suppressBlurElement = null;
    this.alertActions = {};
    this.selectedPartId = null;
    this.selectedRawNode = null;
    this.selectedPartStats = null;
    this.partDrag = false;
    this.historicalParts = null;
    this.loadedSourceHash = null;
    this.bind();
    this.render();
  }

  get scope() { return this.context ? scopeFor(this.context) : 'base'; }
  get stackKey() { return this.context ? `${this.context.slug}|${this.scope}` : ''; }
  get stack() {
    if (!this.stacks.has(this.stackKey)) this.stacks.set(this.stackKey, { undo: [], redo: [] });
    return this.stacks.get(this.stackKey);
  }
  get supported() { return !!this.snapshot?.eligible; }
  get readOnly() { return !this.supported || this.snapshot?.editable === false || !!this.context?.skin || !!this.context?.version; }
  get fresh() {
    return !!this.snapshot?.preview?.current && !!this.report?.hashes?.source &&
      this.report.hashes.source === this.snapshot.preview.sourceHash && this.loadedSourceHash === this.snapshot.preview.sourceHash && !this.previewPending && !this.previewError;
  }

  async setContext(context) {
    if (this.context?.slug !== context.slug) { this.selectedPartId = null; this.selectedRawNode = null; this.selectedPartStats = null; }
    this.context = { ...context };
    this.report = null;
    this.historicalParts = null;
    this.loadedSourceHash = null;
    this.previewError = null;
    this.previewPending = false;
    this.pendingAction = null;
    this.queuedActions = [];
    this.openSaveWhenFresh = false;
    this.clearAlert();
    $('exportResult').classList.add('hidden');
    $('exportResult').innerHTML = '';
    $('saveVersionForm').classList.add('hidden');
    this.snapshot = null;
    const generation = ++this.generation;
    this.render();
    if (!context.slug) return;
    try {
      const snapshot = await this.fetchSnapshot(context);
      if (generation !== this.generation) return;
      this.snapshot = snapshot;
      this.render();
      this.showRecovery();
    } catch (error) {
      if (generation === this.generation) this.showAlert(`Could not load editor: ${error.message}`, { Retry: () => this.setContext(this.context) });
    }
  }

  async fetchSnapshot(context = this.context) {
    const query = new URLSearchParams({ slug: context.slug, profile: context.profile });
    if (context.variant) query.set('variant', context.variant);
    if (context.skin) query.set('skin', context.skin);
    return request(`/api/editor?${query}`);
  }

  async refresh() {
    const context = this.context;
    if (!context?.slug) return;
    const generation = this.generation;
    try {
      const snapshot = await this.fetchSnapshot(context);
      if (generation !== this.generation) return;
      const revisionChanged = snapshot.revision !== this.snapshot?.revision;
      if (revisionChanged && !this.mutationBusy) {
        for (const key of [...this.stacks.keys()]) if (key.startsWith(`${context.slug}|`)) this.stacks.delete(key);
      }
      this.snapshot = snapshot;
      if (revisionChanged || !this.isTyping()) this.render();
      else this.renderActions();
      if (revisionChanged) this.showRecovery();
      return true;
    } catch (error) {
      if (generation === this.generation) this.showAlert(`Could not refresh editor: ${error.message}`, { Retry: () => this.refresh() });
      return false;
    }
  }

  isTyping() { return $('editFields').contains(document.activeElement) && ['number', 'text'].includes(document.activeElement?.type); }

  setReport(report, { error = null, pending = false } = {}) {
    this.report = report || null;
    this.previewError = error;
    this.previewPending = pending;
    if (error) this.openSaveWhenFresh = false;
    this.renderActions();
  }

  setLoadedSourceHash(hash) {
    this.loadedSourceHash = hash || null;
    this.renderActions();
  }

  setHistoricalParts(parts) {
    this.historicalParts = parts || [];
    this.render();
  }

  markPreviewPending() {
    this.previewPending = true;
    this.report = null;
    this.loadedSourceHash = null;
    this.renderActions();
  }

  render() {
    const fields = $('editFields');
    const snapshot = this.context?.version && this.historicalParts ? {
      ...this.snapshot,
      parts: this.historicalParts,
      partTransforms: {
        ...this.snapshot?.partTransforms,
        baseline: Object.fromEntries(this.historicalParts.map((part) => [part.id, IDENTITY])),
        effective: Object.fromEntries(this.historicalParts.filter((part) => part.delta).map((part) => [part.id, part.delta])),
        origins: Object.fromEntries(this.historicalParts.map((part) => [part.id, 'saved'])),
      },
    } : this.snapshot;
    if (!this.context?.slug) fields.innerHTML = '<p class="muted">Choose an asset to inspect it.</p>';
    else if (!snapshot) fields.innerHTML = '<p class="muted">Loading controls…</p>';
    else if (!this.supported) fields.innerHTML = this.selectedRawNode
      ? `<section class="edit-group"><h3>${esc(this.selectedRawNode.name === 'body' ? 'Body (merged)' : this.selectedRawNode.name)}</h3><p class="note">Exported GLB node · read-only${this.selectedRawNode.hasMesh ? ' mesh' : ' group'}.</p>${this.selectedPartStats ? `<p class="note">${this.selectedPartStats.triangles.toLocaleString()} triangles · ${esc(this.selectedPartStats.materials.join(', ') || 'no materials')}</p>` : ''}</section>`
      : '<p class="muted">This asset is available for preview. Visual editing is enabled for curated pilot assets.</p>';
    else {
      const note = this.context.version ? '<p class="note">Saved version preview is read-only. Return to Working copy to edit.</p>'
        : this.context.skin ? '<p class="note">Skins are preview-only in this editor. Choose the default skin to edit base or variant parameters.</p>'
          : this.context.variant ? `<p class="note">Editing variant <strong>${esc(this.context.variant)}</strong>. Reset edit reveals the authored variant value, or inherits the base value.</p>`
            : '<p class="note">Changes are saved to the working copy automatically. Save Version to keep a named snapshot.</p>';
      fields.innerHTML = `${note}${controlsMarkup(snapshot, this.readOnly)}${this.selectedRawNode ? `<section class="edit-group"><h3>${esc(this.selectedRawNode.name === 'body' ? 'Body (merged)' : this.selectedRawNode.name)}</h3><p class="note">Exported GLB node · read-only${this.selectedRawNode.hasMesh ? ' mesh' : ' group'}. Select an editable part to transform it.</p>${this.selectedPartStats ? `<p class="note">${this.selectedPartStats.triangles.toLocaleString()} triangles · ${esc(this.selectedPartStats.materials.join(', ') || 'no materials')}</p>` : ''}</section>` : snapshot.parts?.length ? partMarkup(snapshot, this.selectedPartId, this.readOnly || this.partDrag, this.selectedPartStats) : ''}`;
    }
    this.renderActions();
  }

  renderActions() {
    const snapshot = this.snapshot;
    const quality = $('quality');
    const status = $('editStatus');
    const historical = !!this.context?.version;
    const fresh = this.fresh && !!this.report && !historical;
    const report = this.report;
    const editable = this.supported && !this.readOnly && !this.mutationBusy && !this.partDrag;
    $('undoEdit').disabled = !editable || !this.stack.undo.length;
    $('redoEdit').disabled = !editable || !this.stack.redo.length;
    $('saveVersionBtn').disabled = !editable || !fresh;
    $('exportBtn').disabled = !this.context?.slug || historical || !!this.context?.skin || !fresh || !report?.ok || this.mutationBusy || this.partDrag;
    $('exportBtn').textContent = `Export ${this.context?.profile || ''}`;

    const history = snapshot?.history;
    if (!this.context?.slug) status.textContent = '';
    else if (historical) status.textContent = 'Saved version · read-only';
    else if (!this.supported) status.textContent = 'Preview only';
    else if (this.partDrag) status.textContent = 'Part transform draft · release to save, Escape to cancel';
    else if (this.mutationBusy) status.textContent = 'Saving working copy…';
    else if (history?.dirty) status.textContent = `Working copy autosaved · not versioned${history.head ? ` since ${history.head.id || history.head}` : ''}`;
    else status.textContent = history?.head ? `Saved ${history.head.id || history.head}` : 'Working copy ready';
    status.className = `edit-status ${this.previewError ? 'error' : this.previewPending ? 'pending' : fresh ? 'ok' : ''}`;

    let text = '';
    let kind = '';
    if (!this.context?.slug) text = 'Select an asset';
    else if (historical) text = 'Historical preview · Generic report';
    else if (this.partDrag) { text = 'Part transform draft · export paused'; kind = 'pending'; }
    else if (this.previewError) { text = 'Preview out of date · build failed'; kind = 'error'; }
    else if (this.previewPending || snapshot && !snapshot.preview?.current) { text = 'Updating exported preview…'; kind = 'pending'; }
    else if (!report) text = 'Waiting for validation report';
    else {
      const tris = `${Number(report.triangles?.total || 0).toLocaleString()} tris`;
      const budget = report.triangles?.budget ? ` / ${Number(report.triangles.budget).toLocaleString()}` : '';
      if (report.counts?.error) { text = `${report.counts.error} errors block export · ${tris}${budget}`; kind = 'error'; }
      else if (report.counts?.warning) { text = `Ready with ${report.counts.warning} warning${report.counts.warning === 1 ? '' : 's'} · ${tris}${budget}`; kind = 'warn'; }
      else { text = `Ready to export · ${tris}${budget} · ${report.materials?.length || 0} materials · ${report.textures?.length || 0} textures`; kind = 'ok'; }
    }
    quality.textContent = text;
    quality.className = `quality ${kind}`;
    this.onStateChange?.(this);
    this.maybeOpenSaveForm();
  }

  maybeOpenSaveForm() {
    if (!this.openSaveWhenFresh || !this.fresh || this.mutationBusy || this.readOnly) return;
    this.openSaveWhenFresh = false;
    $('saveVersionBtn').click();
  }

  openSaveFromShortcut(target) {
    if (this.readOnly || this.partDrag) return;
    if ($('editFields').contains(target) && target?.dataset?.partId) {
      const part = this.snapshot?.parts?.find((item) => item.id === target.dataset.partId);
      try { this.parsePartValue(part, target.dataset.partField, Number(target.dataset.partAxis), target.value); }
      catch (error) { this.showPartError(target.dataset.partId, error.message); return; }
      this.openSaveWhenFresh = true;
      this.suppressBlurElement = target;
      target.blur();
      this.commitPart(target.dataset.partId, target.dataset.partField, Number(target.dataset.partAxis), target.value).then(() => this.maybeOpenSaveForm());
      return;
    }
    const field = $('editFields').contains(target) && ['number', 'hex'].includes(target?.dataset?.role) ? target : null;
    if (field) {
      const control = this.snapshot?.controls?.find((item) => item.key === field.dataset.key);
      try { this.parseValue(control, field.value); }
      catch (error) { this.showFieldError(field.dataset.key, error.message); return; }
      this.openSaveWhenFresh = true;
      this.suppressBlurElement = field;
      field.blur();
      this.commit(field.dataset.key, field.value).then(() => this.maybeOpenSaveForm());
      return;
    }
    if (!this.fresh && !this.previewPending && !this.mutationBusy) {
      this.showAlert('Wait for the current exported preview before saving a version.');
      return;
    }
    this.openSaveWhenFresh = true;
    this.maybeOpenSaveForm();
  }

  showAlert(message, actions = {}) {
    const box = $('editAlert');
    this.alertActions = actions;
    box.innerHTML = `<div>${esc(message)}</div>${Object.keys(actions).map((name, i) => `<button type="button" data-alert-action="${i}">${esc(name)}</button>`).join('')}`;
    box.classList.remove('hidden');
  }

  clearAlert() {
    $('editAlert').classList.add('hidden');
    $('editAlert').innerHTML = '';
    this.alertActions = {};
  }

  showFieldError(key, message) {
    const control = [...$('editFields').querySelectorAll('[data-control]')].find((el) => el.dataset.control === key);
    if (!control) return;
    const error = control.querySelector('[data-error]');
    error.textContent = message;
    error.classList.remove('hidden');
    for (const input of control.querySelectorAll('input, select')) input.setAttribute('aria-invalid', 'true');
  }

  clearFieldError(key) {
    const control = [...$('editFields').querySelectorAll('[data-control]')].find((el) => el.dataset.control === key);
    if (!control) return;
    const error = control.querySelector('[data-error]');
    error.textContent = '';
    error.classList.add('hidden');
    for (const input of control.querySelectorAll('input, select')) input.removeAttribute('aria-invalid');
  }

  currentMap(snapshot = this.snapshot) {
    return copy(this.context?.variant ? snapshot?.overrides?.variants?.[this.context.variant] : snapshot?.overrides?.base);
  }

  currentParts(snapshot = this.snapshot) {
    return clone(this.context?.variant ? snapshot?.partTransforms?.overrides?.variants?.[this.context.variant] || {} : snapshot?.partTransforms?.overrides?.base || {});
  }

  currentState(snapshot = this.snapshot) { return { values: this.currentMap(snapshot), partTransforms: this.currentParts(snapshot) }; }

  setSelectedPart(id, raw = null, stats = null) {
    const parts = this.context?.version ? this.historicalParts : this.snapshot?.parts;
    this.selectedPartId = parts?.some((part) => part.id === id) ? id : null;
    this.selectedRawNode = raw;
    this.selectedPartStats = stats;
    this.render();
  }

  setPartDrag(dragging) {
    this.partDrag = !!dragging;
    this.render();
  }

  parsePartValue(part, field, axis, raw) {
    const n = Number(raw);
    if (String(raw).trim() === '' || !Number.isFinite(n)) throw new Error('Enter a valid number.');
    const limits = field === 'move' ? [-200, 200] : field === 'rotation' ? [-180, 180] : [25, 400];
    if (n < limits[0] || n > limits[1]) throw new Error(`Enter ${limits[0]}–${limits[1]}${field === 'move' ? ' cm' : field === 'rotation' ? '°' : '%'}.`);
    if (!part.transform?.[field === 'rotation' ? 'rotate' : field]) throw new Error('This transform is not editable.');
    if (field !== 'scale' && (axis < 0 || axis > 2)) throw new Error('Invalid axis.');
    return n;
  }

  async commitPart(id, field, axis, raw, { reset = false, whole = null } = {}) {
    if (this.readOnly || !this.snapshot || this.partDrag) return;
    const part = this.snapshot.parts?.find((item) => item.id === id);
    if (!part?.editable) return;
    if (!whole && field !== 'all' && !part.transform?.[field === 'rotation' ? 'rotate' : field]) return;
    const baseline = this.snapshot.partTransforms?.baseline?.[id] || IDENTITY;
    const effective = this.snapshot.partTransforms?.effective?.[id] || IDENTITY;
    let value = clone(effective);
    try {
      if (whole) value = clone(whole);
      else if (reset && field === 'all') value = clone(baseline);
      else if (field === 'move') { value.move[axis] = reset ? baseline.move[axis] : this.parsePartValue(part, field, axis, raw) / 100; }
      else if (field === 'scale') value.scale = reset ? baseline.scale : this.parsePartValue(part, field, axis, raw) / 100;
      else if (field === 'rotation') {
        const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...effective.rotation), 'XYZ');
        const baseEuler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...baseline.rotation), 'XYZ');
        const values = [euler.x, euler.y, euler.z];
        values[axis] = reset ? [baseEuler.x, baseEuler.y, baseEuler.z][axis] : this.parsePartValue(part, field, axis, raw) * Math.PI / 180;
        value.rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...values, 'XYZ')).normalize().toArray();
      }
      if (value.move.some((n) => !Number.isFinite(n) || Math.abs(n) > 2) ||
          value.rotation.some((n) => !Number.isFinite(n)) ||
          Math.abs(Math.hypot(...value.rotation) - 1) > 1e-4 ||
          !Number.isFinite(value.scale) || value.scale < 0.25 || value.scale > 4) throw new Error('Part transform is outside the allowed range.');
    } catch (error) { this.showPartError(id, error.message); return; }
    this.clearPartError(id);
    if (this.mutationBusy) {
      this.queuedActions = this.queuedActions.filter((action) => action.partId !== id);
      this.queuedActions.push({ partId: id, field, axis, raw, reset, whole, stackKey: this.stackKey });
      return;
    }
    const previous = this.currentState();
    const next = this.currentState();
    if (JSON.stringify(value) === JSON.stringify(baseline)) delete next.partTransforms[id];
    else next.partTransforms[id] = value;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    await this.mutate(next, { partId: id, value, priorValue: clone(effective), field, axis, reset, whole: !!whole }, { record: true, before: previous });
  }

  showPartError(id, message) {
    const node = [...$('editFields').querySelectorAll('[data-part-error]')].find((el) => el.dataset.partError === id);
    if (node) { node.textContent = message; node.classList.remove('hidden'); }
  }
  clearPartError(id) {
    const node = [...$('editFields').querySelectorAll('[data-part-error]')].find((el) => el.dataset.partError === id);
    if (node) { node.textContent = ''; node.classList.add('hidden'); }
  }

  parseValue(control, raw) {
    if (control.type === 'color') {
      const value = String(raw).trim();
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Use a six-digit hex color, for example #d9b98c.');
      return value.toLowerCase();
    }
    if (control.type === 'boolean') return Boolean(raw);
    if (control.type === 'select') {
      const option = (control.options || []).map((v) => typeof v === 'object' ? v.value : v).find((v) => String(v) === String(raw));
      if (option === undefined) throw new Error('Choose an available option.');
      return option;
    }
    if (String(raw).trim() === '') throw new Error('Enter a value.');
    const value = Number(raw) / scaleFor(control);
    if (!Number.isFinite(value)) throw new Error('Enter a valid number.');
    if (control.type === 'integer' && !Number.isInteger(value)) throw new Error('Enter a whole number.');
    if (value < control.min - 1e-9 || value > control.max + 1e-9) {
      throw new Error(`Enter ${formatNumber(control.min, control)}–${formatNumber(control.max, control)}${control.displayUnit || control.unit ? ` ${control.displayUnit || control.unit}` : ''}.`);
    }
    const step = Number(control.step || (control.type === 'integer' ? 1 : 0));
    if (step > 0 && Math.abs((value - Number(control.min || 0)) / step - Math.round((value - Number(control.min || 0)) / step)) > 1e-6) {
      throw new Error(`Use increments of ${formatNumber(step, control)}${control.displayUnit || control.unit ? ` ${control.displayUnit || control.unit}` : ''}.`);
    }
    return Number(value.toFixed(6));
  }

  async commit(key, raw, { reset = false } = {}) {
    if (this.readOnly || !this.snapshot) return;
    const control = this.snapshot.controls.find((item) => item.key === key);
    if (!control) return;
    this.clearFieldError(key);
    let value;
    try { if (!reset) value = this.parseValue(control, raw); }
    catch (error) { this.showFieldError(key, error.message); this.flushQueue(); return; }
    if (this.mutationBusy) {
      this.queuedActions = this.queuedActions.filter((queued) => queued.key !== key);
      this.queuedActions.push({ key, raw, reset, stackKey: this.stackKey });
      return;
    }
    const before = this.currentState();
    const next = this.currentState();
    if (reset) delete next.values[key];
    else next.values[key] = value;
    if (JSON.stringify(before) === JSON.stringify(next)) { this.clearDraft(key); this.flushQueue(); return; }
    await this.mutate(next, { key, value, reset }, { record: true, before });
  }

  flushQueue() {
    if (this.mutationBusy) return;
    const queued = this.queuedActions.shift();
    if (queued && queued.stackKey === this.stackKey) queueMicrotask(() => queued.partId ? this.commitPart(queued.partId, queued.field, queued.axis, queued.raw, { reset: queued.reset, whole: queued.whole }) : this.commit(queued.key, queued.raw, { reset: queued.reset }));
    else if (queued) this.flushQueue();
  }

  async mutate(next, action, { record = false, before = null, direction = null } = {}) {
    if (!this.snapshot || this.mutationBusy || this.readOnly) return;
    const context = { ...this.context };
    const generation = this.generation;
    const previous = before || this.currentState();
    const scope = context.variant ? 'variant' : 'base';
    const pending = { slug: context.slug, scope: scopeFor(context), action, savedAt: Date.now() };
    if (action?.key || action?.partId) sessionStorage.setItem(recoveryKey(context.slug, pending.scope), JSON.stringify(pending));
    this.mutationBusy = true;
    this.markPreviewPending();
    try {
      const updated = await post('/api/editor', { slug: context.slug, scope, variant: context.variant, profile: context.profile, ...next, expectedRevision: this.snapshot.revision }, 'PUT');
      sessionStorage.removeItem(recoveryKey(context.slug, pending.scope));
      if (action?.key) this.clearDraft(action.key, context);
      if (action?.partId) this.clearDraft(`part:${action.partId}:${action.field}:${action.axis}`, context);
      if (record) {
        const stack = this.stacks.get(`${context.slug}|${pending.scope}`) || { undo: [], redo: [] };
        stack.undo.push(previous);
        stack.undo = stack.undo.slice(-50);
        stack.redo = [];
        this.stacks.set(`${context.slug}|${pending.scope}`, stack);
      } else if (direction) {
        const stack = this.stacks.get(`${context.slug}|${pending.scope}`);
        if (stack) {
          stack[direction].pop();
          stack[direction === 'undo' ? 'redo' : 'undo'].push(previous);
          stack[direction === 'undo' ? 'redo' : 'undo'] = stack[direction === 'undo' ? 'redo' : 'undo'].slice(-50);
        }
      }
      if (generation === this.generation) {
        this.snapshot = updated;
        this.clearAlert();
        this.render();
        this.onBuild?.();
      }
    } catch (error) {
      this.queuedActions = [];
      this.openSaveWhenFresh = false;
      if (generation === this.generation) {
        if (error.status === 409 && error.body?.current) {
          for (const key of [...this.stacks.keys()]) if (key.startsWith(`${context.slug}|`)) this.stacks.delete(key);
          this.snapshot = error.body.current;
          this.render();
          if (action?.key || action?.partId) this.showAlert('The source changed outside this editor. Review the latest values or reapply your edit.', {
            'Reapply draft': () => this.reapply(action), 'Reload source': () => this.discardRecovery(),
          });
          else { this.stack.undo = []; this.stack.redo = []; this.showAlert('The source changed outside this editor. Undo history was cleared.', { 'Use latest': () => this.clearAlert() }); }
        } else {
          this.showAlert(`Could not save edit: ${error.message}`, action?.key || action?.partId ? { Retry: () => this.reapply(action), 'Discard draft': () => this.discardRecovery() } : {});
          if (action?.key && error.body?.field) this.showFieldError(error.body.field, error.message);
        }
      }
    } finally {
      this.mutationBusy = false;
      if (generation === this.generation) {
        this.renderActions();
        this.flushQueue();
      }
    }
  }

  async reapply(action) {
    this.clearAlert();
    if (!await this.refresh()) return;
    if (action.partId) {
      const part = this.snapshot?.parts?.find((item) => item.id === action.partId);
      if (!part?.editable) { this.showAlert('This part is no longer editable.'); return; }
      const latest = clone(this.snapshot.partTransforms?.effective?.[action.partId] || IDENTITY);
      const prior = action.priorValue || IDENTITY;
      const desired = action.value;
      const merged = clone(latest);
      for (let i = 0; i < 3; i++) if (Math.abs(desired.move[i] - prior.move[i]) > 1e-8) merged.move[i] += desired.move[i] - prior.move[i];
      const rotationDelta = new THREE.Quaternion(...prior.rotation).invert().multiply(new THREE.Quaternion(...desired.rotation));
      merged.rotation = new THREE.Quaternion(...latest.rotation).multiply(rotationDelta).normalize().toArray();
      if (Math.abs(desired.scale - prior.scale) > 1e-8) merged.scale *= desired.scale / prior.scale;
      if (!action.whole && !action.reset && action.field === 'move') merged.move[action.axis] = desired.move[action.axis];
      if (!action.whole && !action.reset && action.field === 'scale') merged.scale = desired.scale;
      await this.commitPart(action.partId, action.field, action.axis, null, { whole: merged });
      return;
    }
    const control = this.snapshot?.controls?.find((item) => item.key === action.key);
    if (!control) { this.showAlert('This control is no longer editable. Reload the source to continue.'); return; }
    if (!action.reset) {
      try { this.parseValue(control, control.type === 'number' || control.type === 'integer' ? formatNumber(action.value, control) : action.value); }
      catch (error) { this.showFieldError(action.key, error.message); return; }
    }
    const next = this.currentState();
    if (action.reset) delete next.values[action.key];
    else next.values[action.key] = action.value;
    await this.mutate(next, action, { record: true, before: this.currentState() });
  }

  discardRecovery() {
    if (this.context) {
      sessionStorage.removeItem(recoveryKey(this.context.slug, this.scope));
      sessionStorage.removeItem(draftKey(this.context.slug, this.scope));
    }
    this.clearAlert();
    this.onDiscardDraft?.();
    this.refresh();
  }

  showRecovery() {
    if (!this.context || this.readOnly) return;
    const raw = sessionStorage.getItem(recoveryKey(this.context.slug, this.scope));
    if (raw) {
      try {
        const pending = JSON.parse(raw);
        const values = this.currentState();
        if (pending.action?.key && (pending.action.reset ? !has(values.values, pending.action.key) : values.values[pending.action.key] === pending.action.value) ||
            pending.action?.partId && JSON.stringify(values.partTransforms[pending.action.partId] || this.snapshot.partTransforms?.baseline?.[pending.action.partId]) === JSON.stringify(pending.action.value)) {
          sessionStorage.removeItem(recoveryKey(this.context.slug, this.scope));
        } else if (pending.action?.key || pending.action?.partId) {
          this.showAlert('An edit was interrupted before the studio confirmed it. Review the current value or reapply it.', {
            'Reapply draft': () => this.reapply(pending.action), 'Reload source': () => this.discardRecovery(),
          });
          return;
        }
      } catch { sessionStorage.removeItem(recoveryKey(this.context.slug, this.scope)); }
    }
    const savedDraft = sessionStorage.getItem(draftKey(this.context.slug, this.scope));
    if (!savedDraft) return;
    try {
      const drafts = JSON.parse(savedDraft);
      for (const [key, value] of Object.entries(drafts)) {
        const input = key.startsWith('part:')
          ? [...$('editFields').querySelectorAll('[data-part-id]')].find((el) => `part:${el.dataset.partId}:${el.dataset.partField}:${el.dataset.partAxis}` === key)
          : [...$('editFields').querySelectorAll('[data-key]')].find((el) => el.dataset.key === key && ['number', 'hex'].includes(el.dataset.role));
        if (input) input.value = value;
      }
      this.showAlert('Uncommitted field text was recovered. Press Enter or leave the field to save it.', {
        'Discard draft': () => { sessionStorage.removeItem(draftKey(this.context.slug, this.scope)); this.clearAlert(); this.render(); },
      });
    } catch { sessionStorage.removeItem(draftKey(this.context.slug, this.scope)); }
  }

  saveDraft(key, value) {
    if (!this.context || this.readOnly) return;
    const storage = draftKey(this.context.slug, this.scope);
    let drafts = {};
    try { drafts = JSON.parse(sessionStorage.getItem(storage) || '{}'); } catch {}
    drafts[key] = value;
    sessionStorage.setItem(storage, JSON.stringify(drafts));
  }

  clearDraft(key, context = this.context) {
    if (!context) return;
    const storage = draftKey(context.slug, scopeFor(context));
    let drafts = {};
    try { drafts = JSON.parse(sessionStorage.getItem(storage) || '{}'); } catch {}
    delete drafts[key];
    if (Object.keys(drafts).length) sessionStorage.setItem(storage, JSON.stringify(drafts));
    else sessionStorage.removeItem(storage);
  }

  async undo() { await this.travel('undo'); }
  async redo() { await this.travel('redo'); }
  async travel(direction) {
    if (this.readOnly || this.partDrag || this.mutationBusy || !this.stack[direction].length) return;
    await this.mutate(clone(this.stack[direction].at(-1)), null, { direction });
  }

  async saveVersion(note) {
    if (this.readOnly || this.partDrag || !this.fresh || !note.trim()) return;
    const context = { ...this.context };
    const generation = this.generation;
    this.mutationBusy = true;
    this.renderActions();
    try {
      await post('/api/history/save', { slug: context.slug, variant: context.variant, note: note.trim(), expectedRevision: this.snapshot.revision });
      if (generation !== this.generation) return;
      $('saveVersionForm').classList.add('hidden');
      $('versionNote').value = '';
      await this.refresh();
      this.onSave?.();
      this.showAlert('Version saved. You can preview or restore it from Versions.');
    } catch (error) {
      if (generation === this.generation) {
        if (error.status === 409) {
          await this.refresh();
          this.showAlert('The source changed before this version could be saved. Review the latest values, then save again.');
        } else this.showAlert(`Could not save version: ${error.message}`, { Retry: () => this.saveVersion(note) });
      }
    }
    finally { this.mutationBusy = false; if (generation === this.generation) this.renderActions(); }
  }

  async restore(version) {
    if (!this.context?.slug || !version || this.partDrag) return;
    if (this.context.skin) {
      this.showAlert('Choose the default skin before restoring an asset version.');
      return;
    }
    const context = { ...this.context };
    const generation = this.generation;
    this.mutationBusy = true;
    this.renderActions();
    try {
      await post('/api/history/restore', { slug: context.slug, version, expectedRevision: this.snapshot.revision });
      if (generation !== this.generation) return;
      this.stacks.delete(`${context.slug}|base`);
      for (const key of [...this.stacks.keys()]) if (key.startsWith(`${context.slug}|variant:`)) this.stacks.delete(key);
      await this.onRestore?.();
      await this.refresh();
      this.showAlert('Version restored to the working copy. Base and variant values were restored together.');
    } catch (error) {
      if (generation === this.generation) {
        if (error.status === 409) await this.refresh();
        this.showAlert(`Could not restore version: ${error.message}`);
      }
    }
    finally { this.mutationBusy = false; if (generation === this.generation) this.renderActions(); }
  }

  async exportCurrent() {
    if (!this.context?.slug || this.context.version || this.context.skin || this.partDrag || !this.fresh || !this.report?.ok || this.mutationBusy) return;
    const context = { ...this.context };
    const generation = this.generation;
    this.mutationBusy = true;
    this.renderActions();
    $('exportResult').classList.add('hidden');
    try {
      const response = await post('/api/export', { slug: context.slug, variant: context.variant, skin: context.skin, profile: context.profile, expectedRevision: this.snapshot.revision });
      if (generation !== this.generation) return;
      const result = response.result;
      if (result?.blocked) {
        this.showAlert(`Export blocked: ${result.reason || 'validation failed'}`);
        return;
      }
      const files = result?.files || response.files;
      if (!files?.glb) throw new Error('Export did not return a GLB file.');
      const box = $('exportResult');
      box.innerHTML = `<h3>Export ready</h3><p class="note">${esc(context.profile)} · ${esc(context.variant || 'base')}</p>
        <a href="${esc(exportHref(files.glb, context.profile))}" download>GLB</a>
        ${files.json ? `<a href="${esc(exportHref(files.json, context.profile))}" download>JSON report</a>` : ''}
        ${files.md ? `<a href="${esc(exportHref(files.md, context.profile))}" download>Import notes</a>` : ''}`;
      box.classList.remove('hidden');
    } catch (error) {
      if (generation === this.generation) {
        if (error.status === 409) await this.refresh();
        this.showAlert(`Export failed: ${error.message}`);
      }
    }
    finally { this.mutationBusy = false; if (generation === this.generation) this.renderActions(); }
  }

  bind() {
    $('undoEdit').addEventListener('click', () => this.undo());
    $('redoEdit').addEventListener('click', () => this.redo());
    $('saveVersionBtn').addEventListener('click', () => {
      document.querySelector('[data-tab="edit"]').click();
      $('saveVersionForm').classList.remove('hidden');
      $('versionNote').focus();
    });
    $('cancelSaveVersion').addEventListener('click', () => $('saveVersionForm').classList.add('hidden'));
    $('saveVersionForm').addEventListener('submit', (event) => { event.preventDefault(); this.saveVersion($('versionNote').value); });
    $('exportBtn').addEventListener('click', () => {
      document.querySelector('[data-tab="edit"]').click();
      this.exportCurrent();
    });
    $('editAlert').addEventListener('click', (event) => {
      const button = event.target.closest('[data-alert-action]');
      if (!button) return;
      Object.values(this.alertActions)[Number(button.dataset.alertAction)]?.();
    });
    $('editFields').addEventListener('click', (event) => {
      const partReset = event.target.closest('[data-reset-part]');
      if (partReset) { this.commitPart(partReset.dataset.resetPart, 'all', 0, null, { reset: true }); return; }
      const partFieldReset = event.target.closest('[data-reset-part-field]');
      if (partFieldReset) {
        const field = partFieldReset.dataset.resetPartField;
        const id = partFieldReset.dataset.partId;
        if (field === 'scale') this.commitPart(id, field, 0, null, { reset: true });
        else {
          const baseline = this.snapshot?.partTransforms?.baseline?.[id] || IDENTITY;
          const effective = clone(this.snapshot?.partTransforms?.effective?.[id] || IDENTITY);
          if (field === 'move') effective.move = [...baseline.move];
          else effective.rotation = [...baseline.rotation];
          this.commitPart(id, field, 0, null, { whole: effective });
        }
        return;
      }
      const button = event.target.closest('[data-reset]');
      if (button) this.commit(button.dataset.reset, null, { reset: true });
    });
    $('editFields').addEventListener('input', (event) => {
      const input = event.target;
      if (input.dataset.partId) { this.saveDraft(`part:${input.dataset.partId}:${input.dataset.partField}:${input.dataset.partAxis}`, input.value); return; }
      const key = input.dataset.key;
      if (!key) return;
      this.clearFieldError(key);
      const control = input.closest('[data-control]');
      if (input.dataset.role === 'range') control.querySelector('[data-role="number"]').value = input.value;
      if (input.dataset.role === 'color') control.querySelector('[data-role="hex"]').value = input.value;
      if (['number', 'hex'].includes(input.dataset.role)) this.saveDraft(key, input.value);
    });
    $('editFields').addEventListener('change', (event) => {
      const input = event.target;
      const key = input.dataset.key;
      if (!key || !this.snapshot) return;
      if (input.dataset.role === 'number' || input.dataset.role === 'hex') return;
      this.commit(key, input.dataset.role === 'boolean' ? input.checked : input.value);
    });
    $('editFields').addEventListener('keydown', (event) => {
      const input = event.target;
      if (input.dataset.partId) {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); this.render(); }
        return;
      }
      if (!input.dataset.key || !['number', 'hex'].includes(input.dataset.role)) return;
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); this.clearDraft(input.dataset.key); this.render(); }
    });
    $('editFields').addEventListener('focusout', (event) => {
      const input = event.target;
      if (input === this.suppressBlurElement) { this.suppressBlurElement = null; return; }
      if (input.dataset.partId) {
        this.commitPart(input.dataset.partId, input.dataset.partField, Number(input.dataset.partAxis), input.value);
        return;
      }
      if (input.dataset.key && ['number', 'hex'].includes(input.dataset.role)) this.commit(input.dataset.key, input.value);
    });
  }
}
