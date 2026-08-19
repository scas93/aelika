/** Rounds to 2 decimal places, avoiding binary floating-point artifacts (e.g. 219.99999999999997). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
