// Pure editor value handling shared by Node builds and browser source renders.
const TYPES = new Set(['number', 'integer', 'color', 'boolean', 'select']);
const HEX = /^#[0-9a-fA-F]{6}$/;

export function editorControls(def) {
  if (!def.editor) return [];
  if (def.editor.version !== 1) throw new Error('editor.version must be 1');
  const groups = def.editor.groups;
  if (!Array.isArray(groups) || (!groups.length && def.editor.controls?.length)) throw new Error('editor.groups must be an array with a group for each control');
  const ids = new Set();
  for (const g of groups) {
    if (!g || typeof g.id !== 'string' || !g.id || typeof g.label !== 'string' || !g.label || ids.has(g.id)) throw new Error('invalid or repeated editor group');
    ids.add(g.id);
  }
  const controls = def.editor?.controls || [];
  if (!Array.isArray(controls)) throw new Error('editor.controls must be an array');
  const seen = new Set();
  for (const c of controls) {
    if (!c || typeof c.key !== 'string' || !Object.hasOwn(def.params, c.key) || seen.has(c.key)) throw new Error(`invalid or repeated editor control '${c?.key}'`);
    seen.add(c.key);
    if (!TYPES.has(c.type)) throw new Error(`editor control '${c.key}' has invalid type '${c.type}'`);
    if (typeof c.label !== 'string' || !c.label || !ids.has(c.group)) throw new Error(`editor control '${c.key}' needs a label and valid group`);
    if (c.type === 'select' && (!Array.isArray(c.options) || !c.options.length || c.options.some((o) => !o || !Object.hasOwn(o, 'value') || !['string', 'number', 'boolean'].includes(typeof o.value) || (typeof o.value === 'number' && !Number.isFinite(o.value)) || typeof o.label !== 'string') || new Set(c.options.map((o) => JSON.stringify(o.value))).size !== c.options.length)) throw new Error(`editor control '${c.key}' needs unique labeled options`);
    if (c.type === 'number' || c.type === 'integer') {
      if (!Number.isFinite(c.min) || !Number.isFinite(c.max) || c.min > c.max || !Number.isFinite(c.step) || c.step <= 0) throw new Error(`editor control '${c.key}' needs finite min/max and positive step`);
    }
    if (c.displayUnit && !c.unit) throw new Error(`editor control '${c.key}' needs a storage unit`);
    if (c.partIds !== undefined && (!Array.isArray(c.partIds) || !c.partIds.length || c.partIds.some((id) => !editorParts(def).some((part) => part.id === id)))) throw new Error(`editor control '${c.key}' has invalid partIds`);
    assertEditorValue(c, def.params[c.key]);
  }
  return controls;
}

export function editorParts(def) {
  if (!def.editor) return [];
  const parts = def.editor.parts || [];
  if (!Array.isArray(parts)) throw new Error('editor.parts must be an array');
  const ids = new Set();
  for (const part of parts) {
    if (!part || typeof part.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(part.id) ||
        ids.has(part.id) || typeof part.label !== 'string' || !part.label.trim()) throw new Error('invalid or repeated editor part');
    ids.add(part.id);
    const transform = part.transform;
    if (!transform || typeof transform !== 'object' || !['move', 'rotate', 'scale'].some((key) => transform[key] === true) ||
        Object.entries(transform).some(([key, value]) => !['move', 'rotate', 'scale'].includes(key) || typeof value !== 'boolean')) {
      throw new Error(`editor part '${part.id}' needs a valid transform capability`);
    }
  }
  return parts;
}

export const IDENTITY_PART_TRANSFORM = Object.freeze({ move: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 1 });
export function emptyPartTransforms() { return { base: {}, variants: {} }; }

export function assertPartTransform(value, id, capability = { move: true, rotate: true, scale: true }) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Array.isArray(value.move) || value.move.length !== 3 || value.move.some((n) => !Number.isFinite(n) || Math.abs(n) > 2) ||
      !Array.isArray(value.rotation) || value.rotation.length !== 4 || value.rotation.some((n) => !Number.isFinite(n)) ||
      Math.abs(Math.hypot(...value.rotation) - 1) > 1e-4 ||
      !Number.isFinite(value.scale) || value.scale < 0.25 || value.scale > 4 ||
      Object.keys(value).some((key) => !['move', 'rotation', 'scale'].includes(key))) throw new Error(`invalid transform for '${id}'`);
  if (!capability.move && value.move.some((n) => Math.abs(n) > 1e-8) ||
      !capability.rotate && value.rotation.some((n, i) => Math.abs(n - (i === 3 ? 1 : 0)) > 1e-8) ||
      !capability.scale && Math.abs(value.scale - 1) > 1e-8) throw new Error(`transform not enabled for '${id}'`);
  const length = Math.hypot(...value.rotation);
  let rotation = value.rotation.map((n) => n / length);
  const signIndex = rotation.findIndex((n) => Math.abs(n) > 1e-8);
  if (signIndex >= 0 && rotation[signIndex] < 0) rotation = rotation.map((n) => -n);
  rotation = rotation.map((n) => +n.toFixed(8));
  return { move: value.move.map((n) => +n.toFixed(6)), rotation, scale: +value.scale.toFixed(6) };
}

export function partTransformState(def, edits, variant = null) {
  const overrides = edits?.partTransforms || emptyPartTransforms();
  const selected = variant ? overrides.variants?.[variant] || {} : {};
  const effective = {};
  const origins = {};
  for (const part of editorParts(def)) {
    const id = part.id;
    effective[id] = selected[id] || overrides.base?.[id] || IDENTITY_PART_TRANSFORM;
    origins[id] = selected[id] ? 'variant-edit' : overrides.base?.[id] ? 'base' : 'default';
  }
  return { baseline: Object.fromEntries(editorParts(def).map((p) => [p.id, variant ? overrides.base?.[p.id] || IDENTITY_PART_TRANSFORM : IDENTITY_PART_TRANSFORM])), effective, origins, overrides };
}

export function assertEditorValue(control, value) {
  const { type, key } = control;
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value)) ||
        (control.min !== undefined && value < control.min) || (control.max !== undefined && value > control.max)) throw new Error(`invalid value for '${key}'`);
    if (control.step !== undefined) {
      const origin = control.min ?? 0;
      const grid = (value - origin) / control.step;
      if (Math.abs(grid - Math.round(grid)) > 1e-7) throw new Error(`invalid step for '${key}'`);
    }
  } else if (type === 'color') {
    if (typeof value !== 'string' || !HEX.test(value)) throw new Error(`invalid color for '${key}'`);
    return value.toLowerCase();
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`invalid boolean for '${key}'`);
  } else if (type === 'select') {
    if (!control.options.some((o) => o.value === value)) throw new Error(`invalid option for '${key}'`);
  }
  return value;
}

export function validateEditorState(def, edits) {
  if (!edits || edits.version !== 1 || !edits.base || !edits.variants ||
      typeof edits.base !== 'object' || Array.isArray(edits.base) ||
      typeof edits.variants !== 'object' || Array.isArray(edits.variants)) throw new Error('invalid editor state');
  const controls = new Map(editorControls(def).map((c) => [c.key, c]));
  const check = (values) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('invalid editor scope');
    for (const [key, value] of Object.entries(values)) {
      const c = controls.get(key);
      if (!c) throw new Error(`'${key}' is not editable`);
      assertEditorValue(c, value);
    }
  };
  check(edits.base);
  for (const [variant, values] of Object.entries(edits.variants)) {
    if (!Object.hasOwn(def.variants, variant)) throw new Error(`unknown editor variant '${variant}'`);
    check(values);
  }
  const transforms = edits.partTransforms || emptyPartTransforms();
  if (!transforms || typeof transforms !== 'object' || Array.isArray(transforms) ||
      !transforms.base || typeof transforms.base !== 'object' || Array.isArray(transforms.base) ||
      !transforms.variants || typeof transforms.variants !== 'object' || Array.isArray(transforms.variants)) throw new Error('invalid part transforms');
  const parts = new Map(editorParts(def).map((part) => [part.id, part]));
  const checkParts = (map) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('invalid part transform scope');
    for (const [id, value] of Object.entries(map)) {
      const part = parts.get(id);
      if (!part) throw new Error(`unknown editable part '${id}'`);
      assertPartTransform(value, id, part.transform);
    }
  };
  checkParts(transforms.base);
  for (const [variant, map] of Object.entries(transforms.variants)) {
    if (!Object.hasOwn(def.variants, variant)) throw new Error(`unknown part transform variant '${variant}'`);
    checkParts(map);
  }
  return edits;
}

export function editorParams(def, edits, variant = null, skin = null, explicit = {}) {
  const base = edits?.base || {};
  const selected = variant ? edits?.variants?.[variant] || {} : {};
  const variantParams = variant ? { ...(def.variants[variant] || {}) } : {};
  delete variantParams.seed;
  return { ...def.params, ...base, ...variantParams, ...selected, ...(skin ? def.skins[skin] || {} : {}), ...explicit };
}

export function editorOrigins(def, edits, variant = null, skin = null) {
  const origins = {};
  for (const c of editorControls(def)) {
    const key = c.key;
    origins[key] = skin && Object.hasOwn(def.skins[skin] || {}, key) ? 'skin' :
      variant && Object.hasOwn(edits?.variants?.[variant] || {}, key) ? 'variant-edit' :
      variant && Object.hasOwn(def.variants[variant] || {}, key) ? 'variant' :
      Object.hasOwn(edits?.base || {}, key) ? 'base' : 'default';
  }
  return origins;
}
