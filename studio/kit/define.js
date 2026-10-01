// defineAsset(): the contract between an asset module and the studio.

const VARIANT_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ORIGINS = new Set(['base-center', 'center', 'back-center', 'none']);

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
 * @param {{meta: AssetMeta, seed?: number, params?: object, variants?: Record<string, object>,
 *          build: (ctx: {p: any, k: any, rng: any, noise: any, THREE: any, variant: string|null}) => any}} def
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
  return Object.freeze({ __studioAsset: 1, meta, seed: def.seed ?? 1, params: def.params || {}, variants, build: def.build });
}
