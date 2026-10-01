// Deterministic random numbers for asset builds.
// Asset code must never use Math.random(): builds have to be reproducible so that a
// revision only changes what was asked for. Use named streams (rng.stream('bolts'))
// so that editing one part never reshuffles the random values of another part.

/** FNV-1a 32-bit hash of a string. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  /** @param {number} seed */
  constructor(seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }

  /** Uniform float in [0, 1). */
  float() {
    return this._next();
  }

  /** Uniform float in [min, max). */
  range(min, max) {
    return min + (max - min) * this._next();
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min, max) {
    return Math.min(max, Math.floor(min + (max - min + 1) * this._next()));
  }

  pick(items) {
    if (!items.length) throw new Error('rng.pick: empty array');
    return items[Math.min(items.length - 1, Math.floor(this._next() * items.length))];
  }

  chance(probability) {
    return this._next() < probability;
  }

  sign() {
    return this._next() < 0.5 ? -1 : 1;
  }

  /** value * (1 ± fraction), e.g. vary(1.2, 0.1) → [1.08, 1.32). */
  vary(value, fraction) {
    return value * (1 + (this._next() * 2 - 1) * fraction);
  }

  /** Symmetric offset in [-amount, amount). */
  jitter(amount) {
    return (this._next() * 2 - 1) * amount;
  }

  /** Normally distributed value (Box–Muller). */
  gauss(mean = 0, sd = 1) {
    const u = Math.max(this._next(), 1e-12);
    const v = this._next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  shuffle(items) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Independent, reproducible child stream identified by name. */
  stream(name) {
    return new Rng(hashString(`${this.seed}:${name}`));
  }
}

/** @param {number|string} seed */
export function createRng(seed = 1) {
  return new Rng(typeof seed === 'string' ? hashString(seed) : Math.floor(seed));
}
