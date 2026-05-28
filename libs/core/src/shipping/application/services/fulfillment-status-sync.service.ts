/**
 * Fulfillment Status Sync Service
 *
 * Branch-1 (OMP-fulfilled) shipment status read-back (#834, ADR-012). The
 * service is the **sole creator and updater** of branch-1 `Shipment` rows
 * — projection-only semantics: a row exists when, and only when, the
 * destination OMP has acted on the order.
 *
 * Pages OL Order Records mirrored to this OMP connection, bounded by a
 * 30-day-default activity window. For each record (in order):
 *
 *  1. Resolve the fulfillment routing for `(sourceConnectionId,
 *     sourceDeliveryMethodId)`. Cache the resolution within this
 *     `sync()` invocation — typical pages have ≤10 distinct delivery
 *     methods, so 100 records collapse to ≤10 routing-service calls.
 *  2. Skip non-branch-1 routings (`ol_managed_carrier` /
 *     `source_brokered`) — those go through `ShipmentStatusSyncService`
 *     (#871), keyed on `providerShipmentId`. Disjoint code paths.
 *  3. Read the OMP's view via `FulfillmentStatusReader.getFulfillmentStatus`.
 *  4. If the snapshot's `status` is `null`, the OMP hasn't acted yet —
 *     skip; the next tick re-checks.
 *  5. Otherwise find-or-create the branch-1 Shipment row (`providerShipmentId
 *     IS NULL`). New rows are written atomic-terminal — born at the
 *     snapshot's status + matching terminal timestamp + tracking number.
 *     The partial-unique index
 *     `UQ_shipments_branch_one_per_order_conn` is the DB-side backstop
 *     against concurrent ticks racing on the same order.
 *
 * Mirrors `ShipmentStatusSyncService` (#871) in shape: the service
 * returns scan stats; the caller (worker handler) advances the persisted
 * `connection_cursors` offset.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IFulfillmentStatusSyncService}
 */

import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';
import {
  type IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  type IFulfillmentRoutingService,
  type FulfillmentRoutingResolution,
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
} from '@openlinker/core/mappings';
import {
  type FulfillmentStatus,
  type FulfillmentStatusSnapshot,
  type IOrderRecordService,
  type OrderProcessorManagerPort,
  type OrderRecord,
  FULFILLMENT_STATUS,
  isFulfillmentStatusReader,
  ORDER_RECORD_SERVICE_TOKEN,
} from '@openlinker/core/orders';

import type { IFulfillmentStatusSyncService } from '../interfaces/fulfillment-status-sync.service.interface';
import type {
  FulfillmentStatusSyncOptions,
  FulfillmentStatusSyncResult,
} from '../types/fulfillment-status-sync.types';
import { DEFAULT_UPDATED_SINCE_DAYS } from '../types/fulfillment-status-sync.types';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import {
  SHIPMENT_STATUS,
  type ShipmentStatus,
} from '../../domain/types/shipment-status.types';
import { SHIPPING_METHOD } from '../../domain/types/shipping-method.types';
import type { Shipment } from '../../domain/entities/shipment.entity';
import type { UpdateShipmentInput } from '../../domain/types/shipment.types';
import { SHIPMENT_REPOSITORY_TOKEN } from '../../shipping.tokens';

/**
 * Project the OMP's neutral `FulfillmentStatus` onto the shipping
 * context's `ShipmentStatus`. The mapping is intentionally identity for
 * the three values — but the seam exists so that shipping can add states
 * (e.g. `in-transit`, `failed`) without those states leaking into the
 * `OrderProcessorManagerPort` contract.
 */
function projectStatus(status: FulfillmentStatus): ShipmentStatus {
  switch (status) {
    case FULFILLMENT_STATUS.Delivered:
      return SHIPMENT_STATUS.Delivered;
    case FULFILLMENT_STATUS.Dispatched:
      return SHIPMENT_STATUS.Dispatched;
    case FULFILLMENT_STATUS.Cancelled:
      return SHIPMENT_STATUS.Cancelled;
    default: {
      // Exhaustiveness guard — a new FulfillmentStatus value added without a
      // matching projection must fail loud, not silently map onto draft.
      const exhaustive: never = status;
      throw new Error(`unknown FulfillmentStatus value: ${String(exhaustive)}`);
    }
  }
}

const ORDER_PROCESSOR_MANAGER_CAPABILITY = 'OrderProcessorManager';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class FulfillmentStatusSyncService implements IFulfillmentStatusSyncService {
  private readonly logger = new Logger(FulfillmentStatusSyncService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    // Cross-context callers go through I*Service per architecture-overview.md
    // § "Cross-context dependencies in core" — repository ports are explicitly
    // forbidden across context boundaries. Same precedent as the sibling
    // ShipmentStatusSyncService (#871).
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(FULFILLMENT_ROUTING_SERVICE_TOKEN)
    private readonly routing: IFulfillmentRoutingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async sync(
    connectionId: string,
    options: FulfillmentStatusSyncOptions,
  ): Promise<FulfillmentStatusSyncResult> {
    const offset = options.offset ?? 0;
    const { limit } = options;
    const updatedSinceDays = options.updatedSinceDays ?? DEFAULT_UPDATED_SINCE_DAYS;
    const updatedSince = new Date(Date.now() - updatedSinceDays * MS_PER_DAY);

    // 1. Page candidate OL Order Records: mirrored to this OMP connection,
    //    fully resolved (recordStatus='ready'), and recently active.
    const page = await this.orderRecords.findMany(
      {
        destinationConnectionId: connectionId,
        recordStatus: 'ready',
        updatedSince,
      },
      { offset, limit },
    );

    // 2. Resolve the OMP OrderProcessor adapter once for this page; bail
    //    early if it doesn't declare FulfillmentStatusReader (the operator
    //    enabled the scheduler task on a platform that doesn't support
    //    branch-1 read-back). Same pattern as ShipmentStatusSyncService.
    let omp: OrderProcessorManagerPort | null = null;
    try {
      omp = await this.integrations.getCapabilityAdapter<OrderProcessorManagerPort>(
        connectionId,
        ORDER_PROCESSOR_MANAGER_CAPABILITY,
      );
    } catch (error) {
      // Adapter resolution threw — this is an integration error, not a
      // platform-shape limitation. Surface it as `failed` so it appears in
      // /sync/jobs as a job-level failure rather than being silently
      // counted as "skipped because the platform doesn't support it".
      this.logger.error(
        `Could not resolve OrderProcessorManager adapter for connection ${connectionId}: ${this.message(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return this.failedResult(page.items.length, page.total, offset);
    }
    if (!isFulfillmentStatusReader(omp)) {
      // Adapter is fine; it just doesn't declare the sub-capability. This
      // is a platform-shape decision (not every OMP supports branch-1
      // read-back). Skipped — operator can disable the scheduler task.
      this.logger.debug(
        `Connection ${connectionId} adapter does not declare FulfillmentStatusReader — skipping scan`,
      );
      return this.zeroResult(page.items.length, page.total, offset);
    }
    const reader = omp;

    // 3. Per-invocation routing-resolution cache. `(sourceConnectionId,
    //    sourceDeliveryMethodId)` is a hot key with low cardinality per page
    //    (typically <10 distinct methods). Lifetime is one sync() call — the
    //    next tick re-reads, so a routing-rule edit becomes visible on the
    //    next page boundary. See plan §3.4 / deep-analysis Q F.
    const routingCache = new Map<string, FulfillmentRoutingResolution>();
    const resolveCached = async (
      sourceConnectionId: string,
      methodId: string | null,
    ): Promise<FulfillmentRoutingResolution> => {
      const key = `${sourceConnectionId}::${methodId ?? '__null__'}`;
      const hit = routingCache.get(key);
      if (hit) return hit;
      const resolution = await this.routing.resolve({
        sourceConnectionId,
        sourceDeliveryMethodId: methodId,
      });
      routingCache.set(key, resolution);
      return resolution;
    };

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const record of page.items) {
      try {
        const sourceDeliveryMethodId = this.extractSourceDeliveryMethodId(record);

        const resolution = await resolveCached(
          record.sourceConnectionId,
          sourceDeliveryMethodId,
        );

        // 4. Only branch-1 rows where this connection is the OMP processor.
        //    `processorConnectionId === null` is the fan-out default — every
        //    destination is a branch-1 OMP; non-null means a specific OMP rule.
        const branchOneForThisConn =
          resolution.processorKind === FULFILLMENT_PROCESSOR_KIND.OmpFulfilled &&
          (resolution.processorConnectionId === null ||
            resolution.processorConnectionId === connectionId);
        if (!branchOneForThisConn) {
          skipped += 1;
          continue;
        }

        const externalOrderId = this.findExternalOrderId(record, connectionId);
        if (!externalOrderId) {
          // Record is mirrored to this connection but hasn't reached
          // 'synced' state yet (or the destination didn't surface an id).
          // Skip — next tick re-checks.
          skipped += 1;
          continue;
        }

        const snapshot = await reader.getFulfillmentStatus({ externalOrderId });

        // 5. Projection-only: status === null ⇒ OMP hasn't acted ⇒ no-op.
        if (snapshot.status === null) {
          skipped += 1;
          continue;
        }

        const existing = await this.shipments.findBranchOneByOrderAndConnection(
          record.internalOrderId,
          connectionId,
        );

        if (!existing) {
          await this.createBranchOneShipment(
            record.internalOrderId,
            connectionId,
            sourceDeliveryMethodId,
            snapshot,
          );
          created += 1;
        } else {
          const patch = this.diffPatch(existing, snapshot);
          if (Object.keys(patch).length > 0) {
            await this.shipments.update(existing.id, patch);
            updated += 1;
          }
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Branch-1 status sync failed for record ${record.internalOrderId} ` +
            `(connection ${connectionId}): ${this.message(error)}`,
        );
      }
    }

    const consumed = offset + page.items.length;
    const nextOffset = consumed >= page.total ? 0 : consumed;

    return {
      scanned: page.items.length,
      created,
      updated,
      skipped,
      failed,
      total: page.total,
      nextOffset,
    };
  }

  /**
   * Pull `Order.shipping.methodId` out of the persisted `orderSnapshot`. The
   * snapshot is typed as `Record<string, unknown>` so the path is narrowed
   * defensively — `OrderRecord` was authored before this field had a typed
   * accessor.
   *
   * **Implicit contract** — the `shipping.methodId` path here mirrors:
   *   - `Order.shipping?.methodId` in `libs/core/src/orders/domain/types/order.types.ts`
   *     (the source-of-truth contract), and
   *   - the persistence shape `OrderRecordService.persistOrder` writes into
   *     `orderSnapshot.shipping` (`libs/core/src/orders/application/services/order-record.service.ts`).
   * If either of those moves the field, this path silently returns `null`
   * for every record and routing falls through to the OMP-fulfilled default.
   * Worth a typed accessor on `OrderRecord` once a second consumer needs it.
   */
  private extractSourceDeliveryMethodId(record: OrderRecord): string | null {
    const shipping = record.orderSnapshot['shipping'];
    if (!shipping || typeof shipping !== 'object') return null;
    const methodId = (shipping as Record<string, unknown>)['methodId'];
    return typeof methodId === 'string' && methodId.length > 0 ? methodId : null;
  }

  /**
   * Locate the destination's `externalOrderId` for this connection from the
   * record's per-destination sync-status entries.
   */
  private findExternalOrderId(record: OrderRecord, connectionId: string): string | null {
    const entry = record.syncStatus.find((s) => s.destinationConnectionId === connectionId);
    return entry?.externalOrderId ?? null;
  }

  private async createBranchOneShipment(
    orderId: string,
    connectionId: string,
    sourceDeliveryMethodId: string | null,
    snapshot: FulfillmentStatusSnapshot,
  ): Promise<void> {
    // `status === null` is filtered upstream; the non-null assertion here
    // is documentation, not optimism.
    const fulfillmentStatus = snapshot.status;
    if (fulfillmentStatus === null) return;
    const shipmentStatus = projectStatus(fulfillmentStatus);
    await this.shipments.create({
      orderId,
      connectionId,
      shippingMethod: SHIPPING_METHOD.Omp,
      sourceDeliveryMethodId: sourceDeliveryMethodId ?? undefined,
      initialStatus: shipmentStatus,
      trackingNumber: snapshot.trackingNumber ?? undefined,
      dispatchedAt:
        fulfillmentStatus === FULFILLMENT_STATUS.Dispatched ? new Date() : undefined,
      deliveredAt:
        fulfillmentStatus === FULFILLMENT_STATUS.Delivered
          ? snapshot.deliveredAt ?? new Date()
          : undefined,
      cancelledAt:
        fulfillmentStatus === FULFILLMENT_STATUS.Cancelled ? new Date() : undefined,
    });
  }

  /**
   * Build the minimum patch from `(existing, snapshot)` that reflects the
   * OMP's current truth. Only fields that actually changed are included so
   * `update()` returns a true "no-op" when nothing diffed.
   */
  private diffPatch(existing: Shipment, snapshot: FulfillmentStatusSnapshot): UpdateShipmentInput {
    const patch: UpdateShipmentInput = {};
    if (snapshot.status !== null) {
      const projectedStatus = projectStatus(snapshot.status);
      if (projectedStatus !== existing.status) {
        patch.status = projectedStatus;
        if (snapshot.status === FULFILLMENT_STATUS.Dispatched && !existing.dispatchedAt) {
          patch.dispatchedAt = new Date();
        }
        if (snapshot.status === FULFILLMENT_STATUS.Delivered && !existing.deliveredAt) {
          patch.deliveredAt = snapshot.deliveredAt ?? new Date();
        }
        if (snapshot.status === FULFILLMENT_STATUS.Cancelled && !existing.cancelledAt) {
          patch.cancelledAt = new Date();
        }
      }
    }
    if (
      snapshot.trackingNumber !== null &&
      snapshot.trackingNumber !== existing.trackingNumber
    ) {
      patch.trackingNumber = snapshot.trackingNumber;
    }
    return patch;
  }

  private zeroResult(
    scanned: number,
    total: number,
    offset: number,
  ): FulfillmentStatusSyncResult {
    const consumed = offset + scanned;
    return {
      scanned,
      created: 0,
      updated: 0,
      skipped: scanned,
      failed: 0,
      total,
      nextOffset: consumed >= total ? 0 : consumed,
    };
  }

  /**
   * Page-level failure shape — adapter resolution threw, no per-record
   * processing happened. Counts the whole page as `failed` so the worker
   * job surfaces in `/sync/jobs` as a failure rather than a successful
   * no-op. Cursor still advances to avoid replaying the same page on
   * every tick of a broken connection.
   */
  private failedResult(
    scanned: number,
    total: number,
    offset: number,
  ): FulfillmentStatusSyncResult {
    const consumed = offset + scanned;
    return {
      scanned,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: scanned,
      total,
      nextOffset: consumed >= total ? 0 : consumed,
    };
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
