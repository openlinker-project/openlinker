/**
 * Bulk Shipment Dispatch Types
 *
 * Contracts for `IBulkShipmentDispatchService` (#964) — dispatch N orders'
 * labels in one operator action, then produce one carrier handover protocol
 * over the dispatched shipments.
 *
 * Each item is a per-order dispatch payload minus the bulk-shared
 * `sourceConnectionId` — derived from the shipped `ShipmentDispatchInput`
 * (#835) via `Omit` so the two can't drift (the per-order seam stays the single
 * source of truth for the label payload shape). The synchronous orchestrator
 * reconstructs a full `ShipmentDispatchInput` per item by re-attaching the
 * shared connection id and looping the existing `dispatch()` — see
 * [ADR-019](../../../../../docs/architecture/adrs/019-synchronous-bulk-shipment-dispatch.md).
 *
 * @module libs/core/src/shipping/application/types
 */

import type { Shipment } from '../../domain/entities/shipment.entity';
import type { ShipmentDispatchInput } from './shipment-dispatch.types';

/** A single order's dispatch payload within a bulk request (sans the shared connection). */
export type BulkShipmentDispatchItem = Omit<ShipmentDispatchInput, 'sourceConnectionId'>;

export type BulkShipmentDispatchInput = {
  /** The bulk scope: every item dispatches from this order-source connection. */
  sourceConnectionId: string;
  /**
   * Per-order payloads. Bounded by the API (N≤25, ADR-019) — the synchronous
   * loop issues N sequential outbound calls, so the cap bounds request
   * wall-clock; the core service itself does not re-impose the cap.
   */
  items: BulkShipmentDispatchItem[];
};

/**
 * Per-order outcome. Mirrors `ShipmentDispatchResult` but adds `orderId` (so the
 * operator can correlate each result to its order) and a third `failed` variant:
 * the per-order seam surfaces a label failure as a THROW (the row is persisted
 * `failed` first), and the bulk loop catches it into this variant so one bad
 * order never sinks its successful siblings (AC-6).
 */
export type PerOrderDispatchResult =
  | { readonly kind: 'dispatched'; readonly orderId: string; readonly shipment: Shipment }
  | { readonly kind: 'omp_fulfilled'; readonly orderId: string }
  | { readonly kind: 'failed'; readonly orderId: string; readonly error: string };

/**
 * Result of a bulk dispatch — the per-order outcome list. The handover protocol
 * is produced by a SEPARATE call (`generateProtocol`) so this stays pure JSON
 * and the protocol can stream as binary (ADR-019 / the #884 label-download
 * pattern). The FE collects the dispatched shipment ids from `results`, then
 * requests the protocol over them.
 */
export type BulkShipmentDispatchResult = {
  readonly results: PerOrderDispatchResult[];
};
