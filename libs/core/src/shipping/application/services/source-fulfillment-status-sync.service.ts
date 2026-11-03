/**
 * Source Fulfillment Status Sync Service
 *
 * The source-side twin of the branch-1 read-back (#834, ADR-012 amendment).
 * `FulfillmentStatusSyncService` asks an order's DESTINATION shop how it
 * shipped the mirrored order; this service asks the order's SOURCE (the
 * marketplace or shop OL ingested it from) whether somebody other than
 * OpenLinker shipped it there - a merchant packing in the Shoper panel, a
 * warehouse working straight off Allegro - and adding a tracking number OL
 * would otherwise never see.
 *
 * Pages the `ready`, not-cancelled OL Order Records ingested from one source
 * connection, bounded by the same 30-day-default activity window as the
 * destination read-back, and for each:
 *
 *  1. Cheap, read-only gates first (no marketplace call): a cancelled order, a
 *     source-observed row that already holds its waybill (re-driving its relay
 *     if that is still owed), or an order OL already tracks.
 *  2. Ask the source through `OrderFulfillmentReadback.readFulfillment`
 *     (#3365), narrowed off the dispatched `OrderSource` adapter - a source
 *     that declares no readback skips the whole page.
 *  3. Act only on `outcome: 'read'`, `dispatched: true` and a waybill OL does
 *     not already know. `waybills: null` ("not reported") and `[]` ("listed
 *     none") both carry nothing to record, and neither is ever read as a claim
 *     that the order shipped without one.
 *  4. Find-or-create the source-observed row and relay `dispatched` + the
 *     waybill to the order's destinations.
 *
 * ## The row is a branch-1 row on the SOURCE connection
 *
 * `connectionId = source`, `providerShipmentId = NULL`, `shippingMethod = omp`,
 * born `dispatched`: exactly the shape `createBranchOneShipment` writes for a
 * destination, because it is the same fact - a platform OL does not drive
 * reported that it shipped, and OL holds no provider id for the parcel. The
 * partial-unique `UQ_shipments_branch_one_per_order_conn` keys on
 * `(orderId, connectionId, direction)`, so this row and a destination's
 * branch-1 row for the same order can never collide: an order's source is
 * never one of its destinations. That pair - the source connection plus a NULL
 * provider id - is what identifies a source-observed row; a `source_brokered`
 * label (Allegro Delivery) also sits on the source connection but always
 * carries the carrier's provider id.
 *
 * ## Echo guard (ADR-027)
 *
 * OpenLinker itself writes dispatches INTO the source through
 * `OrderStatusWriteback` - its own labels, a destination's branch-1 dispatch,
 * a late carrier waybill (#1947). Reading those back must never mint a second
 * shipment or relay the same parcel a second time. So:
 *
 *  - an order on which OL already holds a live (not failed, not cancelled)
 *    shipment with a tracking number is not read at all - whatever the source
 *    shows, OL already knows a parcel for it, and the readback call is saved;
 *  - a waybill equal to a tracking number on ANY outbound shipment of the
 *    order (failed and cancelled included) is OL's own, echoed back, and is
 *    ignored; only the first waybill OL does not know is recorded;
 *  - a dispatch with no waybill at all is ignored, because OL relays
 *    tracking-less dispatches too (a destination that shipped without a
 *    number, a fulfilment work) and a bare "sent" cannot be told apart from
 *    that echo.
 *
 * The reverse loop - this relay reaching a destination whose own branch-1
 * read-back then reports the parcel and relays it back to the source - is
 * closed in `FulfillmentStatusSyncService`, which suppresses its source relay
 * when the order already carries a source-observed row for that waybill.
 *
 * ## Relay
 *
 * Through `relayWaybillUnderClaim`, i.e. the role-agnostic lifecycle relay with
 * the source as ORIGIN (excluded), under the at-most-once claim on
 * `Shipment.waybillRelayedAt` (#1947) with its failure accounting (#2073) and
 * give-up bound (#3506). Unlike the carrier poll, the waybill is persisted on
 * the row up front - the source has already reported it, so withholding it
 * would hide a known parcel - and the retry signal is the claim alone: a row
 * holding a waybill whose claim is free is owed a relay, and step 1 re-drives
 * it on a later tick without asking the source again. An order with no
 * destination at all is not relayed (there is nobody to tell, and the relay
 * would count it as a failure forever); its row stays owed, so a destination
 * added later still learns of the parcel.
 *
 * No carrier hint is sent: the hint is a shipping-provider connection's
 * `platformType`, the source connection is not one, and the receiving shop
 * adapters do not read it.
 *
 * Mirrors `FulfillmentStatusSyncService` in shape: the service returns scan
 * stats; the worker handler advances the persisted `connection_cursors` offset.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {ISourceFulfillmentStatusSyncService}
 * @see {@link FulfillmentStatusSyncService} for the destination-side twin
 */

import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  type IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  type IOrderLifecycleRelayService,
  type IOrderRecordService,
  type OrderFulfillmentReadback,
  type OrderRecord,
  type OrderSourcePort,
  type SourceFulfillmentReadback,
  type SourceFulfillmentWaybill,
  isOrderFulfillmentReadback,
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
} from '@openlinker/core/orders';

import type { ISourceFulfillmentStatusSyncService } from '../interfaces/source-fulfillment-status-sync.service.interface';
import { IOrderFulfillmentProjectionService } from '../interfaces/order-fulfillment-projection.service.interface';
import { DEFAULT_UPDATED_SINCE_DAYS } from '../types/fulfillment-status-sync.types';
import type {
  SourceFulfillmentStatusSyncOptions,
  SourceFulfillmentStatusSyncResult,
} from '../types/source-fulfillment-status-sync.types';
import { relayWaybillUnderClaim } from './waybill-relay';
import type { Shipment } from '../../domain/entities/shipment.entity';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import {
  SHIPMENT_STATUS,
  type ShipmentStatus,
} from '../../domain/types/shipment-status.types';
import { SHIPPING_METHOD } from '../../domain/types/shipping-method.types';
import {
  ORDER_FULFILLMENT_PROJECTION_SERVICE_TOKEN,
  SHIPMENT_REPOSITORY_TOKEN,
} from '../../shipping.tokens';

const ORDER_SOURCE_CAPABILITY = 'OrderSource';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A shipment in one of these states describes no parcel that is on its way, so
 * its tracking number does not mean "OL already knows how this order shipped".
 * It still counts as KNOWN for the echo filter: a voided label's number that OL
 * once relayed into the source can still be read back from it.
 */
const DEAD_SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  SHIPMENT_STATUS.Failed,
  SHIPMENT_STATUS.Cancelled,
];

/** Statuses from which a source-observed row may relay its waybill. */
const RELAYABLE_STATUSES: readonly ShipmentStatus[] = [
  SHIPMENT_STATUS.Dispatched,
  SHIPMENT_STATUS.InTransit,
  SHIPMENT_STATUS.Delivered,
];

/** What one record contributed to the page's stats. */
interface RecordOutcome {
  readonly kind: 'created' | 'updated' | 'skipped';
  /** A waybill relay for this record landed this tick. */
  readonly relayed: boolean;
}

const SKIPPED: RecordOutcome = { kind: 'skipped', relayed: false };

/**
 * Waybills are compared trimmed and case-folded: two spellings of one parcel
 * must read as the same parcel, or a casing difference between what OL wrote
 * and what the source echoes back would mint a duplicate shipment. Folding can
 * only ever make the echo guard MORE conservative.
 */
function normaliseWaybill(waybill: string): string {
  return waybill.trim().toUpperCase();
}

@Injectable()
export class SourceFulfillmentStatusSyncService implements ISourceFulfillmentStatusSyncService {
  private readonly logger = new Logger(SourceFulfillmentStatusSyncService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    // Cross-context reads go through I*Service per architecture-overview.md
    // § "Cross-context dependencies in core", as in FulfillmentStatusSyncService.
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(ORDER_FULFILLMENT_PROJECTION_SERVICE_TOKEN)
    private readonly fulfillmentProjection: IOrderFulfillmentProjectionService,
    @Inject(ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN)
    private readonly orderLifecycleRelay: IOrderLifecycleRelayService,
  ) {}

  async sync(
    connectionId: string,
    options: SourceFulfillmentStatusSyncOptions,
  ): Promise<SourceFulfillmentStatusSyncResult> {
    const offset = options.offset ?? 0;
    const { limit } = options;
    const updatedSinceDays = options.updatedSinceDays ?? DEFAULT_UPDATED_SINCE_DAYS;
    const updatedSince = new Date(Date.now() - updatedSinceDays * MS_PER_DAY);

    // `cancelled: false` keeps a cancelled order out of the page entirely; the
    // per-record check below is the backstop for one cancelled between the
    // read and the readback.
    const page = await this.orderRecords.findMany(
      {
        sourceConnectionId: connectionId,
        recordStatus: 'ready',
        updatedSince,
        cancelled: false,
      },
      { offset, limit },
    );

    let source: OrderSourcePort;
    try {
      source = await this.integrations.getCapabilityAdapter<OrderSourcePort>(
        connectionId,
        ORDER_SOURCE_CAPABILITY,
      );
    } catch (error) {
      // An integration error (disabled connection, credentials), not a platform
      // shape: surfaced as `failed` so the job reads as a failure in /sync/jobs.
      this.logger.error(
        `Could not resolve OrderSource adapter for connection ${connectionId}: ${this.message(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return this.pageResult(page.items.length, page.total, offset, { failed: page.items.length });
    }
    if (!isOrderFulfillmentReadback(source)) {
      // A platform-shape decision: this source cannot report its fulfilment.
      this.logger.debug(
        `Connection ${connectionId} source does not declare OrderFulfillmentReadback - skipping scan`,
      );
      return this.pageResult(page.items.length, page.total, offset, { skipped: page.items.length });
    }
    const reader = source;

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let relayed = 0;

    for (const record of page.items) {
      try {
        const outcome = await this.syncRecord(connectionId, reader, record);
        if (outcome.kind === 'created') created += 1;
        else if (outcome.kind === 'updated') updated += 1;
        else skipped += 1;
        if (outcome.relayed) relayed += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Source fulfillment sync failed for record ${record.internalOrderId} ` +
            `(connection ${connectionId}): ${this.message(error)}`,
        );
      }
    }

    const consumed = offset + page.items.length;
    return {
      scanned: page.items.length,
      created,
      updated,
      relayed,
      skipped,
      failed,
      total: page.total,
      nextOffset: consumed >= page.total ? 0 : consumed,
    };
  }

  private async syncRecord(
    connectionId: string,
    reader: OrderFulfillmentReadback,
    record: OrderRecord,
  ): Promise<RecordOutcome> {
    if (record.isCancelled) {
      return SKIPPED;
    }

    // Outbound only (#2373): this is about the parcel going to the buyer.
    const orderShipments = await this.shipments.findByOrderId(record.internalOrderId, 'outbound');
    const sourceRow =
      orderShipments.find(
        (s) => s.connectionId === connectionId && s.providerShipmentId === null,
      ) ?? null;

    // A source-observed row that already holds its waybill has nothing more to
    // learn from the source; it may still owe its destinations the relay.
    if (sourceRow !== null && sourceRow.trackingNumber !== null) {
      const redriven = await this.relayIfOwed(record, sourceRow, sourceRow.trackingNumber);
      return { kind: 'skipped', relayed: redriven };
    }

    // OL already knows a live parcel for this order (its own label, a
    // destination's branch-1 dispatch): whatever the source shows is that
    // parcel, so the readback is not worth a marketplace call.
    const alreadyTracked = orderShipments.some(
      (s) => s.trackingNumber !== null && !DEAD_SHIPMENT_STATUSES.includes(s.status),
    );
    if (alreadyTracked) {
      return SKIPPED;
    }

    const externalOrderId = await this.resolveSourceExternalOrderId(
      record.internalOrderId,
      connectionId,
    );
    if (externalOrderId === null) {
      return SKIPPED;
    }

    const readback = await this.readSafely(reader, externalOrderId, connectionId);
    if (readback === null || readback.outcome !== 'read' || readback.dispatched !== true) {
      return SKIPPED;
    }

    const waybill = this.firstUnknownWaybill(readback.waybills, orderShipments);
    if (waybill === null) {
      return SKIPPED;
    }

    let row: Shipment;
    let kind: RecordOutcome['kind'];
    if (sourceRow === null) {
      row = await this.shipments.create({
        orderId: record.internalOrderId,
        connectionId,
        shippingMethod: SHIPPING_METHOD.Omp,
        initialStatus: SHIPMENT_STATUS.Dispatched,
        trackingNumber: waybill,
        // OL's clock: the readback carries no dispatch instant, and this is
        // when OL learnt of it - the same choice the destination path makes.
        dispatchedAt: new Date(),
      });
      kind = 'created';
      // A new dispatched shipment moves the order rollup (#1108).
      await this.fulfillmentProjection.recompute(record.internalOrderId);
    } else {
      // A source-observed row without a waybill: fill it in (null -> value),
      // the #1947 late-waybill shape. A dead row is not revived by a number.
      if (!RELAYABLE_STATUSES.includes(sourceRow.status)) {
        return SKIPPED;
      }
      row = await this.shipments.update(sourceRow.id, { trackingNumber: waybill });
      kind = 'updated';
    }

    return { kind, relayed: await this.relayIfOwed(record, row, waybill) };
  }

  /**
   * Relay the row's waybill to the order's destinations if it is still owed:
   * the claim is free and the row describes a parcel on its way.
   *
   * An order with no synced destination is left owed rather than relayed - the
   * relay would resolve no participant, count that as a failure on the row, and
   * do so on every tick. Re-checked each tick, so a destination provisioned
   * later still receives the waybill.
   *
   * @returns `true` only when the relay landed this call.
   */
  private async relayIfOwed(
    record: OrderRecord,
    row: Shipment,
    waybill: string,
  ): Promise<boolean> {
    if (row.waybillRelayedAt !== null || !RELAYABLE_STATUSES.includes(row.status)) {
      return false;
    }
    const hasDestination = record.syncStatus.some((s) => Boolean(s.externalOrderId));
    if (!hasDestination) {
      return false;
    }
    const outcome = await relayWaybillUnderClaim(
      {
        shipments: this.shipments,
        orderLifecycleRelay: this.orderLifecycleRelay,
        logger: this.logger,
      },
      row,
      waybill,
      () => Promise.resolve(undefined),
    );
    return outcome === 'relayed';
  }

  /**
   * The first reported waybill no outbound shipment of the order already
   * carries, or `null` when there is none - including `waybills: null` (the
   * source does not report them) and `[]` (it listed none).
   */
  private firstUnknownWaybill(
    waybills: readonly SourceFulfillmentWaybill[] | null,
    orderShipments: readonly Shipment[],
  ): string | null {
    if (waybills === null || waybills.length === 0) {
      return null;
    }
    const known = new Set(
      orderShipments
        .map((s) => s.trackingNumber)
        .filter((t): t is string => t !== null)
        .map(normaliseWaybill),
    );
    for (const entry of waybills) {
      const value = entry.waybill.trim();
      if (value.length > 0 && !known.has(normaliseWaybill(value))) {
        return value;
      }
    }
    return null;
  }

  /**
   * The source-native order id, scoped to THIS source connection - an order
   * also carries destination-side mappings, and asking the source about a
   * destination's id would answer a different question.
   */
  private async resolveSourceExternalOrderId(
    internalOrderId: string,
    connectionId: string,
  ): Promise<string | null> {
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Order,
      internalOrderId,
    );
    return mappings.find((m) => m.connectionId === connectionId)?.externalId ?? null;
  }

  /**
   * The capability forbids throwing for a marketplace-side condition, but an
   * out-of-tree adapter is not bound by a docblock; one order's throw must not
   * read as an OL failure, so it degrades to "no answer".
   */
  private async readSafely(
    reader: OrderFulfillmentReadback,
    externalOrderId: string,
    connectionId: string,
  ): Promise<SourceFulfillmentReadback | null> {
    try {
      return await reader.readFulfillment({ externalOrderId });
    } catch (error) {
      this.logger.warn(
        `source_fulfillment_readback_threw: ${connectionId} raised for order ${externalOrderId} ` +
          `instead of reporting an outcome: ${this.message(error)}`,
      );
      return null;
    }
  }

  private pageResult(
    scanned: number,
    total: number,
    offset: number,
    counts: { skipped?: number; failed?: number },
  ): SourceFulfillmentStatusSyncResult {
    const consumed = offset + scanned;
    return {
      scanned,
      created: 0,
      updated: 0,
      relayed: 0,
      skipped: counts.skipped ?? 0,
      failed: counts.failed ?? 0,
      total,
      nextOffset: consumed >= total ? 0 : consumed,
    };
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
