// Seeded random number generator so a scenario can be regenerated exactly from its seed.

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). Mulberry32. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Picks `count` distinct items. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < count && pool.length > 0) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    }
    return out;
  }

  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  /** Approximately normal, via the sum of uniforms, clamped to ±3 standard deviations. */
  normal(mean: number, sd: number): number {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += this.next();
    return mean + sd * (sum - 3) * Math.SQRT2;
  }
}

export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** Rounds a price the way agents actually list and offer. */
export function roundPrice(value: number): number {
  if (value < 100_000) return Math.round(value / 500) * 500;
  if (value < 1_000_000) return Math.round(value / 1_000) * 1_000;
  return Math.round(value / 5_000) * 5_000;
}

/** Rounds a list price to a "charm" price like $449,900. */
export function listingPrice(value: number): number {
  const step = value < 1_000_000 ? 10_000 : 50_000;
  const rounded = Math.round(value / step) * step;
  return value < 1_000_000 ? rounded - 100 : rounded;
}
