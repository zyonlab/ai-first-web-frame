/**
 * Deterministic pseudo-random number generation for the mock market-data
 * transport. Everything here is self-contained (no external dependency) and
 * pure: given the same seed, every consumer observes byte-identical output.
 *
 * We deliberately avoid `Math.random`/`Date.now` so the synthetic feed is fully
 * reproducible — the same `(seed, symbol)` pair always yields the same stream,
 * which is what makes the demo recordings stable and the tests deterministic.
 */

/**
 * Mixes a 32-bit integer so sequential seeds diverge immediately. This is the
 * classic `Math.imul`-based finalizer; it is used both to derive per-symbol
 * seeds and as the core step of {@link mulberry32}.
 */
function mix32(value: number): number {
  let z = value | 0;
  z = Math.imul(z ^ (z >>> 16), 0x45d9f3b);
  z = Math.imul(z ^ (z >>> 16), 0x45d9f3b);
  z = z ^ (z >>> 16);
  return z >>> 0;
}

/**
 * Hashes a string into a 32-bit unsigned integer (FNV-1a). Used to fold a
 * `symbol` into the numeric seed so BTC and ETH diverge deterministically from
 * the same base seed.
 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Combines a numeric seed and a symbol into a single 32-bit seed. Same
 * `(seed, symbol)` ⇒ same value ⇒ identical stream.
 */
export function deriveSeed(seed: number, symbol: string): number {
  return mix32((seed | 0) ^ hashString(symbol));
}

/** A pure, resumable random source. `state` is the full PRNG state (one u32). */
export type Prng = {
  /** Current internal state (u32). Snapshot it to resume a stream later. */
  readonly state: number;
  /** Draws the next float in [0, 1) and returns the advanced generator. */
  next: () => { prng: Prng; value: number };
};

/**
 * mulberry32 — a tiny, fast, well-distributed 32-bit PRNG. Implemented in an
 * immutable style so callers can snapshot/resume state (the frame generators
 * thread PRNG state through their own state objects rather than mutating a
 * closure).
 */
export function createPrng(seed: number): Prng {
  const state = seed >>> 0;
  return {
    state,
    next() {
      let t = (state + 0x6d2b79f5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return { prng: createPrng(t), value };
    },
  };
}

/** Draws N floats in [0, 1); returns them plus the advanced generator. */
export function drawN(
  prng: Prng,
  count: number,
): { prng: Prng; values: number[] } {
  const values: number[] = [];
  let current = prng;
  for (let i = 0; i < count; i += 1) {
    const step = current.next();
    current = step.prng;
    values.push(step.value);
  }
  return { prng: current, values };
}

/** Uniform float in [min, max). */
export function uniform(
  prng: Prng,
  min: number,
  max: number,
): { prng: Prng; value: number } {
  const step = prng.next();
  return { prng: step.prng, value: min + (max - min) * step.value };
}

/** Integer in [min, max] inclusive. */
export function intBetween(
  prng: Prng,
  min: number,
  max: number,
): { prng: Prng; value: number } {
  const step = prng.next();
  return {
    prng: step.prng,
    value: min + Math.floor(step.value * (max - min + 1)),
  };
}

/**
 * Standard-normal sample via Box–Muller (single value). Used to give the price
 * walk a bell-shaped step distribution instead of a flat uniform one.
 */
export function gaussian(prng: Prng): { prng: Prng; value: number } {
  const a = prng.next();
  const b = a.prng.next();
  // Guard against log(0).
  const u1 = a.value <= Number.EPSILON ? Number.EPSILON : a.value;
  const u2 = b.value;
  const value = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return { prng: b.prng, value };
}
