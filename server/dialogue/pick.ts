// Picks lines from dialogue pools without repeating one in the same deal.
// Each deal keeps a list of the lines it has used; the order is seeded, so a deal replays the same way.

import { Rng } from "../engine/rng";

export type Fill = Record<string, string | number>;

/** Fills {name} placeholders. Unknown names are left as they are, so tests can catch them. */
export function fill(template: string, values: Fill): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A line from `lines` this deal hasn't used yet under `pool`, recorded in `used`.
 * Once every line has been used, it cycles through them again in the same order.
 * Without a `used` list (tests, one-off drafts) it picks by the seed alone.
 */
export function pickLine(pool: string, lines: readonly string[], used: string[] | undefined, seed: number): string {
  if (lines.length === 1) return lines[0];
  const rng = new Rng((seed ^ hash(pool)) >>> 0);
  const order = rng.sample(
    lines.map((_, i) => i),
    lines.length,
  );
  if (!used) return lines[order[0]];
  const id = (i: number) => `${pool}#${i}`;
  const fresh = order.find((i) => !used.includes(id(i)));
  const choice = fresh ?? order[used.filter((u) => u.startsWith(`${pool}#`)).length % order.length];
  used.push(id(choice));
  return lines[choice];
}

/** pickLine, then fill its placeholders. */
export function say(pool: string, lines: readonly string[], values: Fill, used: string[] | undefined, seed: number): string {
  return fill(pickLine(pool, lines, used, seed), values);
}

export const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
