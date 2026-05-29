/**
 * Processor derivation helpers (#839)
 *
 * Pure helpers that derive the FE-facing "processor" view from a Shipment
 * row. The BE doesn't ship a `processor` field on `Shipment` — it's an FE
 * abstraction over the existing routing model:
 *
 *   - `shippingMethod === 'omp'`   → `'omp'`     (branch-1, OMP-fulfilled,
 *                                                projected by the
 *                                                FulfillmentStatusSyncService)
 *   - `providerShipmentId !== null` → `'carrier'` (branches 2/3 — InPost
 *                                                  own-contract or Allegro
 *                                                  Delivery source-brokered)
 *   - otherwise                     → `'pending'` (draft row before the
 *                                                  ShippingProviderManager
 *                                                  adapter has issued a
 *                                                  provider id)
 *
 * v1 is **two-bucket at the row level** ("OMP" vs. "Carrier") — the deeper
 * branch-2 vs. branch-3 disambiguation needs the order's source-platformType
 * cross-reference and is deferred (#839 plan §5).
 *
 * The processor URL-filter on `/shipments` maps to the two BE filters the
 * cross-context #882 work already shipped:
 *
 *   - `?processor=omp`     → `{ shippingMethod: 'omp' }`
 *   - `?processor=carrier` → `{ hasProviderShipmentId: true }`
 *
 * `toShipmentProcessorFilters` is the single source of truth for that
 * mapping so the URL-state read path and the BE-query write path can't
 * drift.
 *
 * @module apps/web/src/features/shipments/lib
 */
import type { Shipment, ShipmentFilters } from '../api/shipments.types';

export const PROCESSOR_KIND_VALUES = ['omp', 'carrier', 'pending'] as const;
export type ProcessorKind = (typeof PROCESSOR_KIND_VALUES)[number];

/**
 * Operator-readable label per processor kind. Used by the `/shipments`
 * Processor column and the processor-filter dropdown. Keyed by
 * `Record<ProcessorKind, string>` so a new processor addition fails
 * type-check until the label is supplied.
 */
export const PROCESSOR_KIND_LABEL: Record<ProcessorKind, string> = {
  omp: 'OMP-fulfilled',
  carrier: 'Carrier',
  pending: 'Pending',
};

/**
 * URL-filterable subset of `ProcessorKind`. `'pending'` is not filterable
 * — it's a derived state with no first-class BE predicate (would require
 * `hasProviderShipmentId=false AND shippingMethod IN ('paczkomat','kurier')`
 * which is non-trivial to express via the existing filter surface). v1
 * exposes only the two confidently-filterable buckets.
 */
export const PROCESSOR_FILTER_VALUES = ['omp', 'carrier'] as const;
export type ProcessorFilter = (typeof PROCESSOR_FILTER_VALUES)[number];

export function deriveProcessor(shipment: Shipment): ProcessorKind {
  if (shipment.shippingMethod === 'omp') return 'omp';
  if (shipment.providerShipmentId !== null) return 'carrier';
  return 'pending';
}

/**
 * Translate a processor URL-state value into the BE `ShipmentFilters` slice
 * the `useShipmentsQuery` hook will send. Returns an empty slice when the
 * processor filter is absent so the caller can spread it into the filters
 * object unconditionally.
 */
export function toShipmentProcessorFilters(
  processor: ProcessorFilter | undefined,
): Pick<ShipmentFilters, 'shippingMethod' | 'hasProviderShipmentId'> {
  if (processor === 'omp') return { shippingMethod: 'omp' };
  if (processor === 'carrier') return { hasProviderShipmentId: true };
  return {};
}

/**
 * Defensive narrower for URL-state read. Returns `undefined` for any
 * unknown value so a stale link with `?processor=foo` falls back to "no
 * filter" instead of pushing garbage to the BE.
 */
export function parseProcessorFilter(raw: string | null): ProcessorFilter | undefined {
  if (raw === null) return undefined;
  return (PROCESSOR_FILTER_VALUES as readonly string[]).includes(raw)
    ? (raw as ProcessorFilter)
    : undefined;
}
