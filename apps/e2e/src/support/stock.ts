/**
 * Stock capture + delta assertions
 *
 * The golden path asserts an exact `baseline - qty` stock movement across every
 * surface (OL master availability, plus the PS / WC / Allegro / Erli reads). To
 * keep those assertions honest, stock is captured as a plain integer snapshot
 * keyed by variant id and compared with whole-number deltas — never a float, and
 * never a "went down a bit" fuzzy check.
 *
 * @module support
 */
import { expect } from '@playwright/test';
import type { ApiClient } from '../api/api-client';
import { pollUntil } from './poller';

/** A snapshot of available quantity per variant id. */
export type StockSnapshot = ReadonlyMap<string, number>;

/**
 * Capture OL master availability for the given internal variant ids. Missing
 * variants are recorded as 0 (the availability endpoint zero-fills), so the map
 * always has an entry for every requested id.
 */
export async function captureStock(
  api: ApiClient,
  variantIds: readonly string[],
): Promise<StockSnapshot> {
  const snapshot = new Map<string, number>(variantIds.map((id) => [id, 0]));
  if (variantIds.length === 0) return snapshot;
  const availability = await api.inventory.availability([...variantIds]);
  for (const entry of availability) {
    snapshot.set(entry.productVariantId, entry.totalAvailable);
  }
  return snapshot;
}

export interface StockDeltaExpectation {
  variantId: string;
  /** Expected decrease from the baseline (e.g. the ordered quantity). */
  soldQty: number;
}

/**
 * Assert that current availability equals `baseline - soldQty` for a variant,
 * with a clear message that names the variant and both values on mismatch.
 */
export function assertStockDelta(
  baseline: StockSnapshot,
  current: StockSnapshot,
  expectation: StockDeltaExpectation,
): void {
  const before = baseline.get(expectation.variantId);
  const after = current.get(expectation.variantId);
  expect(before, `baseline stock missing for variant ${expectation.variantId}`).toBeDefined();
  expect(after, `current stock missing for variant ${expectation.variantId}`).toBeDefined();
  expect(
    after,
    `variant ${expectation.variantId}: expected ${before} - ${expectation.soldQty} = ${
      before! - expectation.soldQty
    }, got ${after}`,
  ).toBe(before! - expectation.soldQty);
}

/**
 * Poll OL availability until a variant reaches an ABSOLUTE target quantity (or
 * time out). Used by the lifecycle suite (propagation fan-out, stale-variant
 * pruning) where there is no "baseline - sold" relationship to lean on — just a
 * known target the master was just synced to.
 */
export async function waitForAvailabilityValue(
  api: ApiClient,
  variantId: string,
  target: number,
  timeoutMs = 120_000,
): Promise<void> {
  await pollUntil(
    () => api.inventory.availability([variantId]),
    (rows) => rows.some((r) => r.productVariantId === variantId && r.totalAvailable === target),
    { timeoutMs, message: `variant ${variantId} availability to reach ${target}` },
  );
}

/**
 * Poll OL availability until a variant reaches `baseline - soldQty` (or time
 * out). Used after an order lands, since propagation is asynchronous.
 */
export async function waitForStockDelta(
  api: ApiClient,
  baseline: StockSnapshot,
  expectation: StockDeltaExpectation,
  timeoutMs = 120_000,
): Promise<void> {
  const before = baseline.get(expectation.variantId);
  expect(before, `baseline stock missing for variant ${expectation.variantId}`).toBeDefined();
  const target = before! - expectation.soldQty;
  await pollUntil(
    () => api.inventory.availability([expectation.variantId]),
    (rows) => rows.some((r) => r.productVariantId === expectation.variantId && r.totalAvailable === target),
    {
      timeoutMs,
      message: `variant ${expectation.variantId} availability to reach ${target} (baseline ${before} - ${expectation.soldQty})`,
    },
  );
}
