/**
 * Largest-Remainder Allocation (Hamilton apportionment)
 *
 * Distributes an authoritative integer total across N parts so the parts sum
 * EXACTLY to the total, proportionally to a set of weights. Each part gets its
 * floored proportional share; the leftover units are handed out one-by-one to
 * the parts with the largest fractional remainder (ties broken by lowest index
 * for determinism).
 *
 * Pure and dependency-free. Operates in integer minor units (e.g. cents) to
 * avoid floating-point drift — callers convert to/from minor units at the
 * boundary. Reused by destination adapters that must decompose a buyer-paid
 * order total across lines under rounding (#895 / ADR-014).
 *
 * @module money
 */

/**
 * Allocate `totalMinor` across `weightsMinor` proportionally, returning integer
 * minor-unit parts that sum to exactly `totalMinor`.
 *
 * When every weight is zero, the total is spread as evenly as possible (the
 * remainder going to the lowest indices), so the result is still exact.
 *
 * @param totalMinor - authoritative total in integer minor units (>= 0)
 * @param weightsMinor - non-negative relative weights, one per part
 * @returns integer minor-unit parts, `parts.length === weightsMinor.length`,
 *          `sum(parts) === totalMinor`
 * @throws RangeError if `totalMinor` is negative/non-integer or any weight is
 *         negative/non-integer
 */
export function allocateByLargestRemainder(totalMinor: number, weightsMinor: number[]): number[] {
  if (!Number.isInteger(totalMinor) || totalMinor < 0) {
    throw new RangeError(`totalMinor must be a non-negative integer, got ${totalMinor}`);
  }
  for (const w of weightsMinor) {
    if (!Number.isInteger(w) || w < 0) {
      throw new RangeError(`weights must be non-negative integers, got ${w}`);
    }
  }

  const n = weightsMinor.length;
  if (n === 0) {
    return [];
  }

  const weightSum = weightsMinor.reduce((acc, w) => acc + w, 0);
  if (weightSum === 0) {
    return distributeEvenly(totalMinor, n);
  }

  const floors: number[] = new Array<number>(n);
  const fractions: Array<{ index: number; fraction: number }> = new Array<{
    index: number;
    fraction: number;
  }>(n);
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const exact = (totalMinor * weightsMinor[i]) / weightSum;
    const floor = Math.floor(exact);
    floors[i] = floor;
    fractions[i] = { index: i, fraction: exact - floor };
    allocated += floor;
  }

  let remainder = totalMinor - allocated;
  // Largest fractional remainder first; ties resolved by lowest index.
  fractions.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let k = 0; remainder > 0; k++, remainder--) {
    floors[fractions[k].index] += 1;
  }

  return floors;
}

/**
 * Spread `totalMinor` across `n` parts as evenly as possible; leftover units go
 * to the lowest indices. Sum is exact.
 */
function distributeEvenly(totalMinor: number, n: number): number[] {
  const base = Math.floor(totalMinor / n);
  let remainder = totalMinor - base * n;
  const parts = new Array<number>(n).fill(base);
  for (let i = 0; remainder > 0; i++, remainder--) {
    parts[i] += 1;
  }
  return parts;
}
