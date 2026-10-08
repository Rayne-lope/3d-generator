// Persisted visual-editor overrides. Asset source remains the procedural authority;
// this small sidecar is part of its source snapshot and build hash.
import fs from 'node:fs';
import path from 'node:path';
import { assetDir, assetFile, paths } from './paths.js';
import { hashDirs, readJson, writeJson } from './fsutil.js';
import { loadAssetDef } from './load-asset.js';
import { isValidSlug, setOfAsset } from './targets.js';
import { editorControls, editorParts, editorOrigins, editorParams, partTransformState, IDENTITY_PART_TRANSFORM, assertEditorValue, assertPartTransform, validateEditorState } from '../kit/editor.js';
import { runAsset } from '../kit/runtime.js';
import { workingState } from './history.js';

export class EditorError extends Error {
  constructor(message, status = 400, field = null, code = null) {
    super(message);
    this.status = status;
    this.field = field;
    this.code = code || ({ 400: 'invalid_input', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 413: 'body_too_large', 415: 'unsupported_media_type', 504: 'timeout' }[status] || 'operation_failed');
  }
}

export function editorFile(slug) { return path.join(assetDir(slug), 'editor.json'); }
const sorted = (values) => Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));

export function assertEditorSlug(slug) {
  if (typeof slug !== 'string' || !isValidSlug(slug)) throw new EditorError('invalid asset slug');
  if (!fs.existsSync(assetFile(slug))) throw new EditorError(`asset '${slug}' not found`, 404);
}

export function editorRevision(slug) {
  assertEditorSlug(slug);
  const set = setOfAsset(slug);
  return hashDirs([assetDir(slug), set ? path.join(paths.sets, set) : null], `editor:${slug}`);
}

export function readEditorOverrides(slug, def = null) {
  assertEditorSlug(slug);
  const file = editorFile(slug);
  if (!fs.existsSync(file)) return { version: 1, base: {}, variants: {} };
  let data;
  try { data = readJson(file); } catch (err) { throw new EditorError(`invalid editor.json for '${slug}': ${err.message}`, 400); }
  if (!data || data.version !== 1 || !data.base || typeof data.base !== 'object' || Array.isArray(data.base) || !data.variants || typeof data.variants !== 'object' || Array.isArray(data.variants)) {
    throw new EditorError(`invalid editor.json for '${slug}'`);
  }
  if (def) {
    try { validateEditorState(def, data); } catch (err) { throw new EditorError(`invalid editor.json for '${slug}': ${err.message}`, 400); }
  }
  return data;
}

function validateLook(def, variant, skin) {
  if (variant && !Object.hasOwn(def.variants, variant)) throw new EditorError(`unknown variant '${variant}'`, 404);
  if (skin && !Object.hasOwn(def.skins, skin)) throw new EditorError(`unknown skin '${skin}'`, 404);
}

export async function editorData(slug, { variant = null, skin = null, profile = 'generic' } = {}) {
  assertEditorSlug(slug);
  const before = editorRevision(slug);
  const def = await loadAssetDef(slug);
  validateLook(def, variant, skin);
  const edits = readEditorOverrides(slug, def);
  const controls = editorControls(def);
  const partCatalog = editorParts(def);
  const parts = partCatalog.length ? runAsset(def, { variant, skin, editor: edits }).parts : [];
  const partState = partTransformState(def, edits, variant);
  const baselineEdits = { ...edits, variants: { ...edits.variants, ...(variant ? { [variant]: {} } : {}) }, base: variant ? edits.base : {} };
  const baselineAll = editorParams(def, baselineEdits, variant, null);
  const effectiveAll = editorParams(def, edits, variant, skin);
  const baseline = {};
  const effective = {};
  for (const c of controls) { baseline[c.key] = baselineAll[c.key]; effective[c.key] = effectiveAll[c.key]; }
  const history = workingState(slug);
  const revision = editorRevision(slug);
  if (revision !== before) throw new EditorError('source changed while reading editor state', 409);
  return {
    slug, variant, skin, profile, schemaVersion: def.editor?.version || null, groups: def.editor?.groups || [], controls,
    parts: parts.filter((part) => partCatalog.some((item) => item.id === part.id)).map((part) => ({ ...part, transform: partCatalog.find((item) => item.id === part.id).transform })),
    partTransforms: partState,
    eligible: controls.length > 0 || partCatalog.length > 0, editable: (controls.length > 0 || partCatalog.length > 0) && !skin,
    baseline, effective, overrides: edits, origins: editorOrigins(def, edits, variant, skin),
    revision,
    history: { head: history.head?.id || null, current: history.current?.id || null, dirty: history.dirty },
  };
}

export async function replaceEditorScope({ slug, scope, variant = null, values, partTransforms, expectedRevision }) {
  assertEditorSlug(slug);
  if (scope !== 'base' && scope !== 'variant') throw new EditorError('scope must be base or variant', 400, 'scope');
  const def = await loadAssetDef(slug);
  if (scope === 'variant' && (!variant || !Object.hasOwn(def.variants, variant))) throw new EditorError(`unknown variant '${variant}'`, 404, 'variant');
  if (scope === 'base' && variant) throw new EditorError('base scope cannot name a variant', 400, 'variant');
  if (values === undefined && partTransforms === undefined) throw new EditorError('values or partTransforms required', 400);
  if (values !== undefined && (!values || typeof values !== 'object' || Array.isArray(values))) throw new EditorError('values must be an object', 400, 'values');
  if (partTransforms !== undefined && (!partTransforms || typeof partTransforms !== 'object' || Array.isArray(partTransforms))) throw new EditorError('partTransforms must be an object', 400, 'partTransforms');
  const currentRevision = editorRevision(slug);
  if (!expectedRevision || expectedRevision !== currentRevision) throw new EditorError('source changed', 409);
  const controls = new Map(editorControls(def).map((c) => [c.key, c]));
  const parts = new Map(editorParts(def).map((item) => [item.id, item]));
  if (!controls.size && !parts.size) throw new EditorError(`asset '${slug}' is not enabled for visual editing`, 403);
  const edits = readEditorOverrides(slug, def);
  const normalized = {};
  const baseline = scope === 'base' ? def.params : editorParams(def, { ...edits, variants: {} }, variant);
  for (const [key, value] of Object.entries(values ?? (scope === 'base' ? edits.base : edits.variants[variant] || {})).sort(([a], [b]) => a.localeCompare(b))) {
    const c = controls.get(key);
    if (!c) throw new EditorError(`'${key}' is not editable`, 400, key);
    let canonical;
    try { canonical = assertEditorValue(c, value); } catch (err) { throw new EditorError(err.message, 400, key); }
    const baselineValue = c.type === 'color' && typeof baseline[key] === 'string' ? baseline[key].toLowerCase() : baseline[key];
    if (canonical !== baselineValue) normalized[key] = canonical;
  }
  const next = { version: 1, base: sorted(scope === 'base' && values !== undefined ? normalized : edits.base), variants: { ...edits.variants } };
  if (scope === 'variant' && values !== undefined) {
    if (Object.keys(normalized).length) next.variants[variant] = normalized;
    else delete next.variants[variant];
  }
  const oldTransforms = edits.partTransforms || { base: {}, variants: {} };
  const transformScope = scope === 'base' ? oldTransforms.base : oldTransforms.variants[variant] || {};
  let normalizedTransforms = transformScope;
  if (partTransforms !== undefined) {
    normalizedTransforms = {};
    const activeParts = new Map(runAsset(def, { variant, editor: edits }).parts.map((part) => [part.id, part]));
    for (const [id, value] of Object.entries(partTransforms).sort(([a], [b]) => a.localeCompare(b))) {
      const part = parts.get(id);
      if (!part) throw new EditorError(`'${id}' is not an editable part`, 400, id);
      if (!activeParts.get(id)?.editable) throw new EditorError(`part '${id}' cannot be transformed in this look: ${activeParts.get(id)?.reason || 'part is missing'}`, 400, id);
      try {
        const canonical = assertPartTransform(value, id, part.transform);
        const baselinePart = scope === 'base' ? IDENTITY_PART_TRANSFORM : oldTransforms.base[id] || IDENTITY_PART_TRANSFORM;
        const baselineCanonical = assertPartTransform(baselinePart, id, part.transform);
        if (JSON.stringify(canonical) !== JSON.stringify(baselineCanonical)) normalizedTransforms[id] = canonical;
      }
      catch (err) { throw new EditorError(err.message, 400, id); }
    }
  }
  const nextTransforms = { base: sorted(scope === 'base' ? normalizedTransforms : oldTransforms.base), variants: { ...oldTransforms.variants } };
  if (scope === 'variant' && partTransforms !== undefined) {
    if (Object.keys(normalizedTransforms).length) nextTransforms.variants[variant] = sorted(normalizedTransforms);
    else delete nextTransforms.variants[variant];
  }
  nextTransforms.variants = sorted(nextTransforms.variants);
  if (Object.keys(nextTransforms.base).length || Object.keys(nextTransforms.variants).length) next.partTransforms = nextTransforms;
  next.variants = sorted(Object.fromEntries(Object.entries(next.variants).map(([name, data]) => [name, sorted(data)])));
  const existing = { version: 1, base: sorted(edits.base), variants: sorted(Object.fromEntries(Object.entries(edits.variants).map(([name, data]) => [name, sorted(data)]))), ...(edits.partTransforms ? { partTransforms: edits.partTransforms } : {}) };
  if (JSON.stringify(existing) === JSON.stringify(next) && (Object.keys(next.base).length || Object.keys(next.variants).length || !!next.partTransforms || !fs.existsSync(editorFile(slug)))) return editorData(slug, { variant });
  const file = editorFile(slug);
  if (editorRevision(slug) !== expectedRevision) throw new EditorError('source changed', 409);
  if (!Object.keys(next.base).length && !Object.keys(next.variants).length && !next.partTransforms) fs.rmSync(file, { force: true });
  else writeJson(file, next);
  return editorData(slug, { variant });
}
