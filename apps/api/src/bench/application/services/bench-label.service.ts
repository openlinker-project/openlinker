/**
 * Bench Label Service (#3654)
 *
 * Replaces the label on a packer's box: cancel the old shipment, buy a new one
 * with the packer's parcel data. Implements {@link IBenchLabelService}.
 *
 * ## Why this is safe to hand to `packer`
 *
 * - Input is parcel data only. The recipient is derived from the order by the
 *   same pure rule the auto-dispatch worker uses (`resolveOrderDispatchTarget`).
 * - It is reached THROUGH the work (scoped by `getWorkForDocuments`, the rule
 *   the parcel itself is opened by) and resolves the shipment from the work's
 *   own link; no shipment id is accepted, so another order's shipment is
 *   unreachable.
 * - Every refusal is decided BEFORE the old label is cancelled.
 *
 * ## A cancel that throws is in doubt, not a failure
 *
 * `cancel()` crosses the carrier boundary, so a throw from it leaves OpenLinker
 * not knowing whether the old label is void. That is answered as
 * `cancelled-not-replaced` with `voidState: 'in-doubt'` - never a 500 the
 * caller could read either way, and never followed by a re-buy (two possibly
 * live labels for one box).
 *
 * ## Serialisation
 *
 * A per-work lock wraps cancel + re-buy so two clicks cannot buy two labels -
 * for as long as the lock lives, which is its TTL
 * ({@link BENCH_LABEL_REPLACE_LOCK_TTL_MS}), not the operation. It is NOT a
 * durable at-most-once guarantee: a cancel plus purchase slow enough to outlast
 * the TTL lets a second click re-enter, find the NEW label live, void it and
 * buy a third. The real fix is a persisted claim on the shipment (the
 * conditional-claim idiom `Shipment.waybillRelayedAt` uses, #1947), not a
 * longer TTL.
 *
 * It cannot be the per-order dispatch lock itself: `dispatch()` acquires that
 * lock internally and it is not re-entrant, so holding it here would make the
 * re-buy refuse. The inner dispatch still takes the per-order lock, so this
 * path also serialises against auto-dispatch and the operator routes.
 *
 * ## Bench never issues
 *
 * Buying a label is not an invoicing or fiscal act; nothing here reaches a
 * sales-document seam (`bench-never-issues.spec.ts`).
 *
 * @module apps/api/src/bench/application/services
 * @implements {IBenchLabelService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { readAutoDispatchConfig } from '@openlinker/core/identifier-mapping';
import type { FulfillmentWorkView } from '@openlinker/core/fulfillment';
import {
  CapabilityNotSupportedException,
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  OrderSnapshotUnavailableError,
  orderFromReadySnapshot,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import {
  SHIPMENT_CANCELLATION_SERVICE_TOKEN,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
  SHIPMENT_STATUS,
  isShipmentCanceller,
  resolveOrderDispatchTarget,
  type IShipmentCancellationService,
  type IShipmentDispatchService,
  type IShipmentQueryService,
  type Shipment,
  type ShipmentCancellationResult,
  type ShippingProviderManagerPort,
  type ShipmentDispatchInput,
  type ShipmentParcel,
} from '@openlinker/core/shipping';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import {
  BENCH_PARCEL_SERVICE_TOKEN,
  type IBenchParcelService,
} from '../interfaces/bench-parcel.service.interface';
import type { IBenchLabelService } from '../interfaces/bench-label.service.interface';
import type {
  BenchReplaceLabelInput,
  BenchReplaceLabelParcel,
  BenchReplaceLabelRefusalReason,
  BenchReplaceLabelResult,
} from '../types/bench-label.types';

/** The work has no outbound shipment at all: nothing to replace (controller: 404). */
export class BenchLabelShipmentNotFoundError extends Error {
  constructor(public readonly workId: string) {
    super(`Work ${workId} has no shipment`);
    this.name = 'BenchLabelShipmentNotFoundError';
  }
}

/**
 * Long enough for cancel + a multi-second label purchase; released in `finally`.
 * The bound of the lock's protection, not of the operation - see the module
 * docblock's "Serialisation".
 */
export const BENCH_LABEL_REPLACE_LOCK_TTL_MS = 180_000;

export function benchLabelReplaceLockKey(workId: string): string {
  return `bench:label-replace:work:${workId}`;
}

const CAPABILITY = 'ShippingProviderManager';
const LIVE_STATUSES: readonly string[] = [
  SHIPMENT_STATUS.Draft,
  SHIPMENT_STATUS.Generated,
  SHIPMENT_STATUS.Dispatched,
];

class Refusal extends Error {
  constructor(public readonly reason: BenchReplaceLabelRefusalReason) {
    super(reason);
  }
}

@Injectable()
export class BenchLabelService implements IBenchLabelService {
  private readonly logger = new Logger(BenchLabelService.name);

  constructor(
    @Inject(BENCH_PARCEL_SERVICE_TOKEN) private readonly parcels: IBenchParcelService,
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN) private readonly shipments: IShipmentQueryService,
    @Inject(SHIPMENT_CANCELLATION_SERVICE_TOKEN)
    private readonly cancellation: IShipmentCancellationService,
    @Inject(SHIPMENT_DISPATCH_SERVICE_TOKEN) private readonly dispatch: IShipmentDispatchService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN) private readonly orderRecords: IOrderRecordService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN) private readonly integrations: IIntegrationsService,
    @Inject(SYNC_LOCK_TOKEN) private readonly lock: SyncLockPort
  ) {}

  async replaceLabel(input: BenchReplaceLabelInput): Promise<BenchReplaceLabelResult> {
    // Scoping first: a work outside this bench answers 404 before anything else.
    const work = await this.parcels.getWorkForDocuments(input.workId);

    const lockKey = benchLabelReplaceLockKey(work.id);
    const token = await this.lock.acquire(lockKey, BENCH_LABEL_REPLACE_LOCK_TTL_MS);
    if (!token) {
      return { outcome: 'refused', reason: 'replace-in-progress' };
    }
    try {
      return await this.replaceLocked(work, input);
    } catch (error) {
      if (error instanceof Refusal) {
        return { outcome: 'refused', reason: error.reason };
      }
      throw error;
    } finally {
      try {
        await this.lock.release(lockKey, token);
      } catch (releaseError) {
        this.logger.warn(
          `Failed to release ${lockKey}: ` +
            `${releaseError instanceof Error ? releaseError.message : String(releaseError)}`
        );
      }
    }
  }

  private async replaceLocked(
    initialWork: FulfillmentWorkView,
    input: BenchReplaceLabelInput
  ): Promise<BenchReplaceLabelResult> {
    // Re-read under the lock: the state that matters may have moved while we waited.
    const work = await this.parcels.getWorkForDocuments(initialWork.id);
    if (work.completedAt !== null) throw new Refusal('parcel-completed');

    const byWork = await this.shipments.findByFulfillmentWorkIds([work.id], 'outbound');
    const all = byWork.get(work.id) ?? [];
    if (all.length === 0) throw new BenchLabelShipmentNotFoundError(work.id);

    const current = this.pickCurrent(all);

    // Everything below that can refuse runs BEFORE the cancel.
    await this.assertCancellable(current);
    const dispatchInput = await this.buildDispatchInput(work, input.parcel);

    // Only "keep the current size" resolves a template the packer did not name.
    const keptTemplate =
      input.parcel.kind === 'weight' ? dispatchInput.parcel.template ?? null : null;

    let cancelled: ShipmentCancellationResult;
    try {
      cancelled = await this.cancellation.cancel(current.id);
    } catch (error) {
      // In doubt: the carrier may or may not have voided it. No re-buy.
      this.logger.error(
        `bench_label_void_in_doubt workId=${work.id} shipmentId=${current.id} ` +
          `actor=${input.actorUserId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        outcome: 'cancelled-not-replaced',
        cancelledShipmentId: current.id,
        // The state the cancel was attempted from, as the cancellation itself would report it.
        cancelledAfterDispatch: current.status === SHIPMENT_STATUS.Dispatched,
        voidState: 'in-doubt',
        keptTemplate,
      };
    }
    this.logger.log(
      `bench_label_cancelled workId=${work.id} shipmentId=${current.id} actor=${input.actorUserId}`
    );

    try {
      const result = await this.dispatch.dispatch(dispatchInput);
      if (result.kind !== 'dispatched') {
        // The re-route resolved to a processor that buys no label: the old one is void.
        this.logger.error(
          `bench_label_cancelled_not_replaced workId=${work.id} cancelled=${current.id} ` +
            `actor=${input.actorUserId} reason=no-label-processor`
        );
        return this.notReplaced(cancelled, keptTemplate);
      }
      this.logger.log(
        `bench_label_replaced workId=${work.id} old=${current.id} new=${result.shipment.id} ` +
          `actor=${input.actorUserId} parcel=${JSON.stringify(dispatchInput.parcel)}`
      );
      return {
        outcome: 'replaced',
        cancelledShipmentId: cancelled.shipment.id,
        newShipmentId: result.shipment.id,
        cancelledAfterDispatch: cancelled.cancelledAfterDispatch,
        keptTemplate,
      };
    } catch (error) {
      // dispatch() persists a `failed` shipment row for a label-generation
      // error; that row is the trace the office reads. Never silent.
      this.logger.error(
        `bench_label_cancelled_not_replaced workId=${work.id} cancelled=${current.id} ` +
          `actor=${input.actorUserId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return this.notReplaced(cancelled, keptTemplate);
    }
  }

  private notReplaced(
    cancelled: ShipmentCancellationResult,
    keptTemplate: string | null
  ): BenchReplaceLabelResult {
    return {
      outcome: 'cancelled-not-replaced',
      cancelledShipmentId: cancelled.shipment.id,
      cancelledAfterDispatch: cancelled.cancelledAfterDispatch,
      voidState: 'confirmed',
      keptTemplate,
    };
  }

  /** Newest labelled, still-live shipment; refuses when there is none. */
  private pickCurrent(all: readonly Shipment[]): Shipment {
    const labelled = all
      .filter((s) => s.providerShipmentId !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const live = labelled.find((s) => LIVE_STATUSES.includes(s.status));
    if (live) return live;
    if (
      labelled.some(
        (s) => s.status === SHIPMENT_STATUS.InTransit || s.status === SHIPMENT_STATUS.Delivered
      )
    ) {
      throw new Refusal('already-handed-over');
    }
    throw new Refusal('no-label');
  }

  private async assertCancellable(shipment: Shipment): Promise<void> {
    let adapter: ShippingProviderManagerPort;
    try {
      adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
        shipment.connectionId,
        CAPABILITY
      );
    } catch (error) {
      // Structural (no such capability on this connection) vs transient (the
      // connection is disabled or its credentials do not resolve right now).
      // `CapabilityNotEnabledException` extends the not-supported one.
      if (error instanceof CapabilityNotSupportedException) throw new Refusal('cannot-cancel');
      this.logger.warn(
        `bench_label_adapter_unresolved shipmentId=${shipment.id} connection=${shipment.connectionId}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      throw new Refusal('adapter-unresolved');
    }
    if (!isShipmentCanceller(adapter)) throw new Refusal('cannot-cancel');
  }

  private async buildDispatchInput(
    work: FulfillmentWorkView,
    body: BenchReplaceLabelParcel
  ): Promise<ShipmentDispatchInput> {
    const parcel = await this.resolveParcel(work, body);

    const record = await this.orderRecords.getOrderRecord(work.orderId);
    if (record === null) throw new Refusal('recipient-unavailable');
    let order;
    try {
      order = orderFromReadySnapshot(record, { requireBuyer: false });
    } catch (error) {
      if (error instanceof OrderSnapshotUnavailableError) throw new Refusal('recipient-unavailable');
      throw error;
    }
    const { deliveryIntent, recipient, paczkomatId } = resolveOrderDispatchTarget(order);
    if (recipient === null) throw new Refusal('recipient-unavailable');

    return {
      sourceConnectionId: record.sourceConnectionId,
      sourceDeliveryMethodId: record.sourceDeliveryMethodId,
      deliveryIntent,
      paczkomatId,
      orderId: work.orderId,
      recipient,
      parcel,
      fulfillmentWorkId: work.id,
    };
  }

  private async resolveParcel(
    work: FulfillmentWorkView,
    body: BenchReplaceLabelParcel
  ): Promise<ShipmentParcel> {
    switch (body.kind) {
      case 'template':
        return { template: body.template };
      case 'box':
        return {
          dimensions: { length: body.lengthMm, width: body.widthMm, height: body.heightMm },
          weightGrams: body.weightGrams,
        };
      case 'weight': {
        // "Keep the current size": a shipment does not persist its parcel, so the
        // size is the executor connection's configured template. Without one there
        // is no size to keep and cancelling would only strand the order.
        const template = await this.configuredTemplate(work);
        if (!template) throw new Refusal('parcel-size-unknown');
        return { template, weightGrams: body.weightGrams };
      }
    }
  }

  private async configuredTemplate(work: FulfillmentWorkView): Promise<string | undefined> {
    if (!work.assignedConnectionId) return undefined;
    try {
      const { connection } = await this.integrations.getAdapter(work.assignedConnectionId);
      return readAutoDispatchConfig(connection.config).parcelTemplate;
    } catch {
      return undefined;
    }
  }
}
