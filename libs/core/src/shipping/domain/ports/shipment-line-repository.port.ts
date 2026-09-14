/**
 * Shipment Line Repository Port (#2727)
 *
 * Persistence contract for the line-grain shipment read model: the
 * counter-bearing `shipment_lines` rows and their append-only act ledger.
 *
 * ## Every read scopes `direction`, and by JOIN rather than by a copied column
 *
 * `direction` lives on `shipments` and stays there. Denormalising it onto the
 * line would create a second source of truth for the one column #2373 / ADR-060
 * exists to BE, and a copy can disagree. Reads therefore join `shipments` and
 * filter there.
 *
 * `direction` is REQUIRED on every read and deliberately not defaulted, for the
 * reason `ShipmentRepositoryPort` gives verbatim: a default is a silent
 * decline — a later call site would read the outbound cohort while believing it
 * read every shipment, and nothing would say so. Reading an arriving return as
 * a dispatch is the #2645 cross-body defect.
 *
 * Domain-only — zero framework imports.
 *
 * @module libs/core/src/shipping/domain/ports
 */

import type { ShipmentDirection } from '../types/shipment-direction.types';
import type { ShipmentLine, ShipmentLineActKind } from '../types/shipment-line.types';

/** One line to record against one shipment. */
export interface UpsertShipmentLineInput {
  readonly shipmentId: string;
  /**
   * The order this LINE belongs to — not necessarily the order the shipment was
   * dispatched for. See `shipment-line.types.ts` for why the distinction is the
   * whole point of the grain.
   */
  readonly orderId: string;
  readonly lineId: string;
  readonly productVariantId: string | null;
  readonly quantity: number;
}

/** One act to record against one line. */
export interface RecordShipmentLineActInput {
  readonly shipmentLineId: string;
  readonly kind: ShipmentLineActKind;
  readonly quantity: number;
  /** The SHIPMENT's own instant — never OL's clock. */
  readonly occurredAt: Date;
}

/**
 * Net shipped / delivered units for one order line, folded across every
 * shipment that carried it.
 */
export interface OrderLineQuantities {
  readonly lineId: string;
  /** `Σ (shippedQuantity − cancelledQuantity)`, never below zero. */
  readonly netShipped: number;
  /** `Σ (deliveredQuantity)` — see the coverage docblock on over-estimation. */
  readonly delivered: number;
}

export interface ShipmentLineRepositoryPort {
  /**
   * Insert the lines that do not exist yet, and leave the ones that do
   * untouched — `quantity` is never rewritten, so a later order edit cannot
   * retroactively restate what an already-shipped parcel undertook.
   *
   * An empty input performs NO query: `IN ()` is a Postgres syntax error rather
   * than an empty set, and an empty ask has an answer that needs none.
   */
  upsertLines(lines: readonly UpsertShipmentLineInput[]): Promise<void>;

  /**
   * Append acts, ignoring any that are already recorded.
   *
   * Idempotency is the `(shipmentLineId, kind, occurredAt)` unique index, not an
   * application check: at READ COMMITTED a plain `SELECT` takes no locks and the
   * conflicting row is a phantom that cannot be locked before it exists (the
   * #2360 / #2400 idiom).
   */
  recordActs(acts: readonly RecordShipmentLineActInput[]): Promise<void>;

  /**
   * Recompute each named line's counters from its acts — a TOTAL fold, never an
   * increment.
   *
   * That is what makes the ledger authoritative and the counters a
   * denormalisation of it (the `reservations` / `inventory_items.olReservedQuantity`
   * shape), and it is also what makes the runtime path CONVERGENT over whatever
   * the #2727 backfill migration wrote: if the two ever disagreed on the acts,
   * the next fold adds the missing ones and the counters follow.
   */
  foldCounters(shipmentIds: readonly string[]): Promise<void>;

  /** Every line recorded against these shipments, whatever their direction. */
  findByShipmentIds(shipmentIds: readonly string[]): Promise<readonly ShipmentLine[]>;

  /**
   * Per-line net shipped / delivered quantities for one order, scoped to ONE
   * direction — the derivation the rollup's coverage arm reads.
   */
  findOrderLineQuantities(
    orderId: string,
    direction: ShipmentDirection,
  ): Promise<readonly OrderLineQuantities[]>;
}
