// defineAsset(): the contract between an asset module and the studio.

const VARIANT_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ORIGINS = new Set(['base-center', 'center', 'back-center', 'none']);
// 'default' names the base look in skin packs and the viewport; 'base' means "no variant".
const RESERVED_SKINS = new Set(['default', 'base', 'all']);

/**
 * @typedef {object} AssetMeta
 * @property {string} title
 * @property {string} [prompt]          the user's original prompt (verbatim)
 * @property {string} [interpretation]  the agent's short reading of the prompt
 * @property {string[]} [style]         style keywords taken from the prompt
 * @property {string} [category]        prop | furniture | container | architecture | environment | nature | vehicle | weapon | lighting | decor | modular
 * @property {{triangles?: number}} [budget]
 * @property {'base-center'|'center'|'back-center'|'none'} [origin]
 * @property {string} [set]             set name when the asset belongs to a pack
 */

/**
 * variants: param/seed overrides that may change the shape (a different item).
 * skins:    param overrides that may only change the surface (textures, colors, finishes).
 *           Every skin must keep the base mesh exactly (checked by the validator), so engines
 *           can swap skins on one model.
 * @param {{meta: AssetMeta, seed?: number, params?: object, variants?: Record<string, object>,
 *          skins?: Record<string, object>,
 *          build: (ctx: {p: any, k: any, rng: any, noise: any, THREE: any, variant: string|null, skin: string|null}) => any}} def
 */
export function defineAsset(def) {
  if (!def || typeof def !== 'object') throw new Error('defineAsset: pass an object');
  if (typeof def.build !== 'function') throw new Error('defineAsset: build({ p, k, rng }) is required');
  const meta = { origin: 'base-center', category: 'prop', style: [], ...(def.meta || {}) };
  if (!meta.title) throw new Error('defineAsset: meta.title is required');
  if (!ORIGINS.has(meta.origin)) throw new Error(`defineAsset: meta.origin must be one of ${[...ORIGINS].join(', ')}`);
  const variants = def.variants || {};
  for (const [name, v] of Object.entries(variants)) {
    if (!VARIANT_RE.test(name)) throw new Error(`defineAsset: variant name '${name}' must be lowercase letters, digits or '-'`);
    if (!v || typeof v !== 'object') throw new Error(`defineAsset: variant '${name}' must be an object of param overrides`);
  }
  const skins = def.skins || {};
  for (const [name, v] of Object.entries(skins)) {
    if (!VARIANT_RE.test(name)) throw new Error(`defineAsset: skin name '${name}' must be lowercase letters, digits or '-'`);
    if (RESERVED_SKINS.has(name)) throw new Error(`defineAsset: '${name}' is reserved; the default params are the base look ('default')`);
    if (!v || typeof v !== 'object') throw new Error(`defineAsset: skin '${name}' must be an object of param overrides`);
    if ('seed' in v) throw new Error(`defineAsset: skin '${name}' cannot change the seed (that usually changes the shape). Give texture painters their own seed param instead.`);
  }
  return Object.freeze({ __studioAsset: 1, meta, seed: def.seed ?? 1, params: def.params || {}, variants, skins, build: def.build });
}
