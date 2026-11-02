/**
 * Stock view helpers (#3569)
 *
 * Pure derivations the M25 stock panel and the products list share, so the
 * "In / Low / Out" badge, the unknown handling and the product-level sums are
 * decided in one place. The rule that runs through all of it: a `null`
 * available-to-promise is "OpenLinker does not know", never zero.
 *
 * @module apps/web/src/features/inventory/lib
 */
import { deriveStockStatus, type StockStatus } from '../../products';
import type { StockViewHold, StockViewVariant } from '../api/inventory.types';

/** A stock status, or `unknown` when available to promise could not be worked out. */
export type AtpStatus = StockStatus | 'unknown';

export function deriveAtpStatus(availableToPromise: number | null | undefined): AtpStatus {
  if (availableToPromise === null || availableToPromise === undefined) return 'unknown';
  return deriveStockStatus(availableToPromise);
}

/** True when the variant's available-to-promise could not be established. */
export function isAtpUnknown(variant: StockViewVariant): boolean {
  return variant.provenance === 'unknown' || variant.availableToPromise === null;
}

/**
 * A variant whose every reported position was marked stale: the master stopped
 * reporting it, so nothing of it is counted.
 */
export function isVariantStaled(variant: StockViewVariant): boolean {
  return variant.positions.length > 0 && variant.livePositionCount === 0;
}

export function isMultiLocation(variant: StockViewVariant): boolean {
  return variant.livePositionCount > 1;
}

/** "7 h ago" / "35 min ago" from a staleness in milliseconds. */
export function formatStaleness(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function publishedHolds(holds: readonly StockViewHold[] | null): StockViewHold[] {
  return (holds ?? []).filter((hold) => hold.atpEffect === 'published');
}

export function recordedOnlyHolds(holds: readonly StockViewHold[] | null): StockViewHold[] {
  return (holds ?? []).filter((hold) => hold.atpEffect === 'diagnostic');
}

export function holdLabel(hold: StockViewHold): string {
  return hold.orderNumber ?? hold.orderRecordId;
}

export interface StockSummary {
  /** `null` when any variant's available to promise is unknown. */
  availableToPromise: number | null;
  masterStock: number;
  /** `null` when any variant's counted holds could not be read. */
  heldCounted: number | null;
  /** Newest `observedAt` across variants, or `null` when none was observed. */
  lastSyncedAt: string | null;
  locationCount: number;
}

export function summarizeStock(variants: readonly StockViewVariant[]): StockSummary {
  let atp: number | null = 0;
  let held: number | null = 0;
  let master = 0;
  let lastSyncedAt: string | null = null;
  let locations = 0;
  for (const variant of variants) {
    master += variant.masterAvailable;
    atp = atp === null || variant.availableToPromise === null ? null : atp + variant.availableToPromise;
    held = held === null || variant.heldCounted === null ? null : held + variant.heldCounted;
    if (variant.observedAt !== null && (lastSyncedAt === null || variant.observedAt > lastSyncedAt)) {
      lastSyncedAt = variant.observedAt;
    }
    locations = Math.max(locations, variant.livePositionCount);
  }
  return { availableToPromise: atp, masterStock: master, heldCounted: held, lastSyncedAt, locationCount: locations };
}

/** The shape of "Rule on this connection", e.g. "Keeps 2 back (safety buffer)". */
export function describeChannelRule(
  rule: { stockSafetyBuffer: number; stockZeroThreshold: number } | null,
): string {
  const parts: string[] = [];
  if (rule && rule.stockSafetyBuffer > 0) parts.push(`Keeps ${rule.stockSafetyBuffer} back (safety buffer)`);
  if (rule && rule.stockZeroThreshold > 0) parts.push(`Shows 0 below ${rule.stockZeroThreshold} units`);
  return parts.length > 0 ? parts.join('. ') : 'No extra rules';
}
