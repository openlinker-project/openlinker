/**
 * Shipment Line Service (#2727)
 *
 * The ONE writer of the line-grain shipment read model, and the derivation the
 * fulfillment rollup's coverage arm consumes.
 *
 * ## One seam, no mutation-service changes
 *
 * `OrderFulfillmentProjectionService.recompute` is already called from all eight
 * shipment-mutation sites, so this hangs off that single funnel rather than
 * being wired into each of them. It is **not unconditional** — three of those
 * sites sit behind a `if (patch.status)` changed-patch gate, so a tracking-only
 * backfill (#1947) or a `labelPdfRef` write does not create missing line rows.
 * That is the SAME gate that produced #2402's permanently-unlinkable branch-1
 * row, and it is recorded rather than asserted away. The dispatch path — where
 * a line first needs to exist — always calls `recompute`.
 *
 * ## Acts are DERIVED from shipment state, then folded
 *
 * Every reconcile re-derives the acts each shipment's current status and
 * timestamps imply and inserts the ones not already recorded, then recomputes
 * the counters from the ledger as a TOTAL fold. That makes the runtime path
 * convergent over whatever the #2727 backfill migration wrote: if the two ever
 * disagreed on the acts, the next fold adds the missing ones and the counters
 * follow. It is also what makes a re-dispatched shipment correct — a new
 * `dispatchedAt` is a new act, because the instant is part of the act's key.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentLineService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  type IOrderRecordService,
  ORDER_RECORD_SERVICE_TOKEN,
  orderFromReadySnapshot,
} from '@openlinker/core/orders';

import type { IShipmentLineService } from '../interfaces/shipment-line.service.interface';
import type { Shipment } from '../../domain/entities/shipment.entity';
import {
  ShipmentLineRepositoryPort} from '../../domain/ports/shipment-line-repository.port';
import type {
  RecordShipmentLineActInput,
  UpsertShipmentLineInput,
} from '../../domain/ports/shipment-line-repository.port';
import type { FulfillmentQuantityCoverage } from '../../domain/types/shipment-line.types';
import { SHIPMENT_LINE_REPOSITORY_TOKEN } from '../../shipping.tokens';

/** Statuses that imply the goods left the building, when no `dispatchedAt` was recorded. */
const SHIPPED_STATUSES = new Set(['dispatched', 'in-transit', 'delivered']);

/** Statuses that reverse a shipment which had already shipped. */
const REVERSING_STATUSES = new Set(['cancelled', 'failed']);

@Injectable()
export class ShipmentLineService implements IShipmentLineService {
  private readonly logger = new Logger(ShipmentLineService.name);

  constructor(
    @Inject(SHIPMENT_LINE_REPOSITORY_TOKEN)
    private readonly lines: ShipmentLineRepositoryPort,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
  ) {}

  async reconcile(
    orderId: string,
    shipments: readonly Shipment[],
  ): Promise<FulfillmentQuantityCoverage | undefined> {
    const items = await this.readOrderItems(orderId);
    if (items.length === 0) {
      // No line data at all. `undefined` means "not known", never "zero
      // delivered" — the distinction the rollup's optional parameter exists to
      // preserve.
      return undefined;
    }

    if (shipments.length > 0) {
      await this.lines.upsertLines(this.buildLines(orderId, shipments, items));
      const persisted = await this.lines.findByShipmentIds(shipments.map((s) => s.id));
      await this.lines.recordActs(this.buildActs(shipments, persisted));
      await this.lines.foldCounters(shipments.map((s) => s.id));
    }

    return this.buildCoverage(orderId, items);
  }

  /**
   * Order lines, read through the ORDERS context's own exported projection.
   *
   * `shipping -> orders` is an existing `I*Service` edge and
   * `orderFromReadySnapshot` is on that barrel, so this grows no second parser
   * of an orders-owned jsonb document in this context.
   *
   * Every failure degrades to "no line data" rather than throwing: an
   * `awaiting_mapping` record, a redacted snapshot, an absent order. The caller
   * is a best-effort projection, and a rollup that refuses to compute is worse
   * than one that computes without the coverage refinement.
   */
  private async readOrderItems(
    orderId: string,
  ): Promise<readonly { lineId: string; quantity: number; variantId: string | null }[]> {
    try {
      const record = await this.orderRecords.getOrderRecord(orderId);
      if (!record) return [];

      // `requireBuyer: false` — a shipped quantity has nothing to do with the
      // buyer's identity, and requiring one would make this unusable under
      // `OL_STORE_PII=false` (the #1908 reasoning, verbatim).
      const order = orderFromReadySnapshot(record, { requireBuyer: false });

      return order.items
        .filter((item) => typeof item.id === 'string' && item.id.length > 0)
        .map((item) => ({
          lineId: item.id,
          quantity: Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0,
          variantId: item.variantId ?? null,
        }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`Shipment-line reconcile found no usable order lines for ${orderId}: ${message}`);
      return [];
    }
  }

  private buildLines(
    orderId: string,
    shipments: readonly Shipment[],
    items: readonly { lineId: string; quantity: number; variantId: string | null }[],
  ): UpsertShipmentLineInput[] {
    return shipments.flatMap((shipment) =>
      items.map((item) => ({
        shipmentId: shipment.id,
        // Today every writer sets this to the shipment's own order. The column
        // is what lets a consolidated parcel stop doing so without a migration.
        orderId,
        lineId: item.lineId,
        productVariantId: item.variantId,
        quantity: item.quantity,
      })),
    );
  }

  /**
   * The acts each shipment's CURRENT state implies, for the lines it carries.
   *
   * `occurredAt` is the shipment's own instant, falling back to its immutable
   * `createdAt` — never `updatedAt`, which moves on every write and, being a
   * key column, would mint a fresh duplicate act on every reconcile.
   */
  private buildActs(
    shipments: readonly Shipment[],
    persistedLines: readonly { id: string; shipmentId: string; quantity: number }[],
  ): RecordShipmentLineActInput[] {
    type PersistedLine = { id: string; shipmentId: string; quantity: number };
    const byShipment = new Map<string, PersistedLine[]>();
    for (const line of persistedLines) {
      const bucket = byShipment.get(line.shipmentId);
      if (bucket) bucket.push(line);
      else byShipment.set(line.shipmentId, [line]);
    }

    const acts: RecordShipmentLineActInput[] = [];

    for (const shipment of shipments) {
      const lines = byShipment.get(shipment.id) ?? [];
      const shipped = shipment.dispatchedAt !== null || SHIPPED_STATUSES.has(shipment.status);
      const delivered = shipment.deliveredAt !== null || shipment.status === 'delivered';
      // A cancel REVERSES a ship, so it requires that a ship happened. A
      // shipment cancelled at `draft` never shipped — there is nothing to
      // reverse, and emitting one anyway would break the capacity CHECK.
      const reversed = shipped && REVERSING_STATUSES.has(shipment.status);

      for (const line of lines) {
        if (line.quantity <= 0) continue;

        if (shipped) {
          acts.push({
            shipmentLineId: line.id,
            kind: 'ship',
            quantity: line.quantity,
            occurredAt: shipment.dispatchedAt ?? shipment.createdAt,
          });
        }
        if (delivered) {
          acts.push({
            shipmentLineId: line.id,
            kind: 'deliver',
            quantity: line.quantity,
            occurredAt: shipment.deliveredAt ?? shipment.createdAt,
          });
        }
        if (reversed) {
          acts.push({
            shipmentLineId: line.id,
            kind: 'cancel',
            quantity: line.quantity,
            occurredAt: shipment.cancelledAt ?? shipment.failedAt ?? shipment.createdAt,
          });
        }
      }
    }

    return acts;
  }

  /**
   * Ordered units versus delivered units, per line and then summed.
   *
   * The per-line CLAMP is what keeps an over-attributed numerator from
   * exceeding what the order actually requires — see
   * {@link FulfillmentQuantityCoverage} for why an over-estimate still makes
   * the rollup's demote-only rule sound.
   */
  private async buildCoverage(
    orderId: string,
    items: readonly { lineId: string; quantity: number }[],
  ): Promise<FulfillmentQuantityCoverage> {
    // Outbound only: a return label is a different cohort and must never
    // contribute to a statement about fulfilling the buyer's order (#2373).
    const quantities = await this.lines.findOrderLineQuantities(orderId, 'outbound');
    const deliveredByLine = new Map(quantities.map((row) => [row.lineId, row.delivered]));

    let ordered = 0;
    let delivered = 0;
    for (const item of items) {
      ordered += item.quantity;
      delivered += Math.min(deliveredByLine.get(item.lineId) ?? 0, item.quantity);
    }

    return { ordered, delivered };
  }
}
