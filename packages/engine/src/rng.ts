/**
 * All randomness in the engine flows through this interface.
 * Production uses crypto-backed rolls; tests use a seeded generator so
 * every rules path is deterministic and replayable.
 */

export interface Rng {
  /** Uniform integer in [min, max], like rolling an n-sided die. */
  int(min: number, max: number): number;
  d6(): number;
  d20(): number;
}

export function die(rng: Rng, sides: number): number {
  return rng.int(1, sides);
}

/** Seeded LCG — deterministic, good enough for tests and simulations. */
export function seededRng(seed: number): Rng {
  let s = (seed >>> 0) || 1;
  const next = () => {
    // Numerical Recipes LCG
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return { int, d6: () => int(1, 6), d20: () => int(1, 20) };
}

/** Fair rolls for production. */
export function cryptoRng(): Rng {
  const int = (min: number, max: number) => {
    const range = max - min + 1;
    const buf = new Uint32Array(1);
    const cryptoObj = globalThis.crypto;
    if (!cryptoObj) throw new Error('WebCrypto unavailable');
    // rejection sampling for uniformity
    const limit = Math.floor(0x100000000 / range) * range;
    let value: number;
    do {
      cryptoObj.getRandomValues(buf);
      value = buf[0]!;
    } while (value >= limit);
    return min + (value % range);
  };
  return { int, d6: () => int(1, 6), d20: () => int(1, 20) };
}

/** Scripted rolls for tests: consumes queued values, then falls back to 1. */
export function scriptedRng(values: number[], fallback: Rng = seededRng(1)): Rng {
  let i = 0;
  const int = (min: number, max: number) => {
    if (i < values.length) {
      const v = values[i++]!;
      const clamped = Math.min(max, Math.max(min, v));
      return clamped;
    }
    return fallback.int(min, max);
  };
  return { int, d6: () => int(1, 6), d20: () => int(1, 20) };
}
