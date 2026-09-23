/**
 * Fulfillment Work Auto-Dispatch Handler (#3340, closing #2729)
 *
 * Handles `fulfillment.work.autoDispatch` — buy a shipping label the moment a
 * routed `FulfillmentWork` was ACCEPTED, on a connection that opted in
 * (`Connection.config.autoDispatch.enabled`). A packer should only print and
 * pack; before this, `ShipmentDispatchService.dispatch()` was reachable only
 * from two operator-gated HTTP routes, so every parcel reached the pack bench
 * unlabelled until somebody clicked Generate label.
 *
 * ## The composition lives HERE, not in `libs/core/src/fulfillment`
 *
 * That context is a registered zero-sibling-edge leaf (ADR-053): it may
 * import no `@openlinker/core/<sibling>` and inject no `orders` / `products`
 * service. Reading the order, reading the variants' weights and calling the
 * shipping seam are all cross-context reads, so — exactly like this job's
 * producer, `FulfillmentWorkDispatchHandler` — they are composed HERE, in the
 * host that already wires every one of them.
 *
 * ## Outcome contract (ADR-007)
 *
 * | Refusal reason | Outcome |
 * |---|---|
 * | `not-enabled` | `business_failure` — the config decided against this, retrying changes nothing |
 * | `already-has-label` | `ok` — a no-op, not a failure: the "buy at most once" guard |
 * | `no-weight` | `business_failure` — a variant carries no weight and no fallback is configured; deterministic until an operator acts |
 * | `no-address` | `business_failure` — the recipient projection could not produce a deliverable address |
 * | `no-delivery-method` (`UndispatchableResolutionException`) | `business_failure` — the resolved processor cannot fulfil this delivery shape; a routing/config fact, not a timing one |
 * | `work-not-eligible`, SETTLED state (order held / payment not cleared) | `business_failure` — the order's current state refuses dispatch; the state is durable, and blindly retrying re-crosses no boundary that would answer differently |
 * | `work-not-eligible`, TIMING state (work/order not found yet, snapshot not readable yet) | **throws** (retryable) — this is exactly the same race `FulfillmentWorkDispatchHandler.resolveShipTo` already tolerates |
 * | carrier rejection / contended dispatch / any other adapter or infra failure | **throws** (retryable) — a carrier timeout or a transient outage is not something this handler can rule out fixing itself; the per-adapter `RetryClassifierPort` (if any) gets the final say via the ordinary retry ladder |
 *
 * PII: nothing here logs the recipient projection or the order snapshot —
 * every log line names ids only, the `FulfillmentWorkDispatchHandler`
 * precedent.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  FulfillmentWorkNotFoundError,
  type FulfillmentWorkView,
  type IFulfillmentWorklistService,
} from '@openlinker/core/fulfillment';
import { readAutoDispatchConfig, type AutoDispatchConfig } from '@openlinker/core/identifier-mapping';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  OrderSnapshotUnavailableError,
  orderFromReadySnapshot,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import {
  OrderNotDispatchableHeldException,
  OrderNotDispatchablePaymentStatusException,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
  UndispatchableResolutionException,
  resolveAutoDispatchDeliveryIntent,
  resolveAutoDispatchParcel,
  resolveAutoDispatchRecipient,
  type IShipmentDispatchService,
  type IShipmentQueryService,
  type ShipmentDispatchInput,
} from '@openlinker/core/shipping';
import type {
  FulfillmentWorkAutoDispatchPayloadV1,
  SyncJob,
  SyncJobHandler,
  SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class FulfillmentWorkAutoDispatchHandler implements SyncJobHandler {
  private readonly logger = new Logger(FulfillmentWorkAutoDispatchHandler.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(FULFILLMENT_WORKLIST_SERVICE_TOKEN)
    private readonly worklist: IFulfillmentWorklistService,
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly shipmentQuery: IShipmentQueryService,
    @Inject(SHIPMENT_DISPATCH_SERVICE_TOKEN)
    private readonly shipmentDispatch: IShipmentDispatchService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.validatePayload(job);
    if (payload === null) return { outcome: 'business_failure' };

    // `not-enabled` — re-checked here even though the producer already gated
    // the enqueue on it, because the connection may have been reconfigured in
    // the window between that enqueue and this job actually running.
    const autoDispatch = await this.resolveAutoDispatchConfig(job);
    if (!autoDispatch.enabled) {
      this.logger.log(
        `fulfillment.work.autoDispatch refused (not-enabled): workId=${payload.workId} ` +
          `connectionId=${job.connectionId}`
      );
      return { outcome: 'business_failure' };
    }

    // `already-has-label` — buy at most once. Not a failure: the "buy at most
    // once" guard from #2402's `shipments.fulfillmentWorkId` link, re-read
    // rather than relied on from memory because this job may run long after
    // (or concurrently with) whatever else touched this work.
    if (await this.hasExistingLabel(payload.workId)) {
      this.logger.log(
        `fulfillment.work.autoDispatch: work ${payload.workId} already has a label ` +
          `(already-has-label) - skipping`
      );
      return { outcome: 'ok' };
    }

    const work = await this.loadWork(job, payload.workId);

    // `no-weight` — the weight decides what the carrier charges, so a mixed
    // known/unknown parcel refuses rather than guessing.
    const parcel = await this.resolveParcel(work, autoDispatch);
    if (parcel === null) {
      this.logger.warn(
        `fulfillment.work.autoDispatch refused (no-weight): workId=${payload.workId} ` +
          `connectionId=${job.connectionId}`
      );
      return { outcome: 'business_failure' };
    }

    const record = await this.orderRecords.getOrderRecord(payload.orderId);
    if (record === null) {
      // Timing state — the same race `FulfillmentWorkDispatchHandler` tolerates.
      throw this.retryable(job, `order record not found: orderId=${payload.orderId}`);
    }

    let order;
    try {
      // `requireBuyer: false` — see the identical note in
      // `FulfillmentWorkDispatchHandler.resolveShipTo`: the buyer-profile gate
      // is invoicing's contract, not a shipping label's. Under
      // `OL_STORE_PII=false` a redacted address is still rehydrated verbatim
      // (redaction placeholders included), and `resolveAutoDispatchRecipient`
      // is what refuses it (`no-address`) rather than a thrown exception here.
      order = orderFromReadySnapshot(record, { requireBuyer: false });
    } catch (error) {
      if (error instanceof OrderSnapshotUnavailableError) {
        throw this.retryable(
          job,
          `order snapshot is not readable yet: orderId=${payload.orderId}`,
          error
        );
      }
      throw error;
    }

    // `no-delivery-method` for a courier order the recipient projection
    // cannot deliver to lives one level down, inside
    // `resolveAutoDispatchRecipient` (reported as `no-address` — a missing
    // street/city/postcode/country is a recipient defect, not a routing
    // one). This resolves only WHICH shape (locker vs courier) to attempt.
    const deliveryIntent = resolveAutoDispatchDeliveryIntent(order.shipping, order.pickupPoint);

    // `no-address`
    const recipient = resolveAutoDispatchRecipient({
      address: order.shippingAddress,
      customerEmail: order.customerEmail,
      deliveryIntent,
    });
    if (recipient === null) {
      this.logger.warn(
        `fulfillment.work.autoDispatch refused (no-address): workId=${payload.workId} ` +
          `orderId=${payload.orderId}`
      );
      return { outcome: 'business_failure' };
    }

    const input: ShipmentDispatchInput = {
      sourceConnectionId: record.sourceConnectionId,
      sourceDeliveryMethodId: record.sourceDeliveryMethodId,
      deliveryIntent,
      paczkomatId: order.pickupPoint?.id,
      orderId: payload.orderId,
      recipient,
      parcel,
    };

    try {
      const result = await this.shipmentDispatch.dispatch(input);
      if (result.kind === 'dispatched') {
        this.logger.log(
          `fulfillment.work.autoDispatch: bought a label for work ${payload.workId} ` +
            `(shipment ${result.shipment.id})`
        );
      } else {
        this.logger.log(
          `fulfillment.work.autoDispatch: work ${payload.workId} resolves to an ` +
            `OMP-fulfilled processor - no label to buy`
        );
      }
      return { outcome: 'ok' };
    } catch (error) {
      if (
        error instanceof OrderNotDispatchablePaymentStatusException ||
        error instanceof OrderNotDispatchableHeldException
      ) {
        // `work-not-eligible`, a SETTLED state. Terminal: the order's current
        // state refuses dispatch and nothing about it changes on a blind
        // retry — an operator can still dispatch it by hand once the payment
        // clears or the hold is released.
        this.logger.warn(
          `fulfillment.work.autoDispatch refused (work-not-eligible): workId=${payload.workId} ` +
            `orderId=${payload.orderId} reason=${error.message}`
        );
        return { outcome: 'business_failure' };
      }
      if (error instanceof UndispatchableResolutionException) {
        // `no-delivery-method` — a routing/config fact (the resolved
        // processor cannot fulfil this delivery shape at all), not a timing
        // one, so it is terminal too.
        this.logger.warn(
          `fulfillment.work.autoDispatch refused (no-delivery-method): workId=${payload.workId} ` +
            `orderId=${payload.orderId} reason=${error.message}`
        );
        return { outcome: 'business_failure' };
      }
      // `carrier-refused` and every other adapter/infra failure (a
      // `ShippingProviderRejectionException`, a `ShipmentDispatchContendedException`,
      // a network timeout): none of these is something this handler can rule
      // out fixing on retry, so it re-enters the ordinary retry ladder rather
      // than being swallowed here.
      this.logger.warn(
        `fulfillment.work.autoDispatch (carrier-refused): workId=${payload.workId} ` +
          `orderId=${payload.orderId}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw new SyncJobExecutionError(
        `fulfillment.work.autoDispatch: carrier dispatch failed for workId=${payload.workId}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async resolveAutoDispatchConfig(job: SyncJob): Promise<AutoDispatchConfig> {
    try {
      const { connection } = await this.integrations.getAdapter(job.connectionId);
      return readAutoDispatchConfig(connection.config);
    } catch (error) {
      // A disabled connection or a credential failure — transient, an
      // operator re-enabling it makes the same job succeed unchanged.
      throw new SyncJobExecutionError(
        `fulfillment.work.autoDispatch could not resolve the connection: connectionId=${job.connectionId}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * `already-has-label` — a shipment already carries this work's link AND a
   * `providerShipmentId`. A row that exists but never got as far as a
   * provider id (e.g. a prior FAILED attempt) is not a label, so it does not
   * count here; `ShipmentDispatchService.dispatch()` reuses/retries such a
   * row on its own.
   */
  private async hasExistingLabel(workId: string): Promise<boolean> {
    const byWork = await this.shipmentQuery.findByFulfillmentWorkIds([workId], 'outbound');
    const shipments = byWork.get(workId) ?? [];
    return shipments.some((shipment) => shipment.providerShipmentId !== null);
  }

  private async loadWork(job: SyncJob, workId: string): Promise<FulfillmentWorkView> {
    try {
      return await this.worklist.get(workId);
    } catch (error) {
      if (error instanceof FulfillmentWorkNotFoundError) {
        // Timing state: the accept that triggered this job is durable, so a
        // work genuinely missing here is a read racing the write, not a
        // permanent condition.
        throw this.retryable(job, `work not found: workId=${workId}`, error);
      }
      throw error;
    }
  }

  private async resolveParcel(
    work: FulfillmentWorkView,
    autoDispatch: AutoDispatchConfig
  ): Promise<ShipmentDispatchInput['parcel'] | null> {
    const variantIds = Array.from(new Set(work.lines.map((line) => line.productVariantId)));
    const variants = variantIds.length === 0 ? [] : await this.products.getVariantsByIds(variantIds);
    const weightByVariantId = new Map(variants.map((variant) => [variant.id, variant.weightGrams]));

    return resolveAutoDispatchParcel(work.lines, weightByVariantId, {
      parcelTemplate: autoDispatch.parcelTemplate,
      defaultWeightGrams: autoDispatch.defaultWeightGrams,
    });
  }

  private retryable(job: SyncJob, message: string, cause?: Error): SyncJobExecutionError {
    return new SyncJobExecutionError(
      `fulfillment.work.autoDispatch: ${message}`,
      job.id,
      job.jobType,
      job.connectionId,
      cause
    );
  }

  private validatePayload(job: SyncJob): FulfillmentWorkAutoDispatchPayloadV1 | null {
    const payload = job.payload as Partial<FulfillmentWorkAutoDispatchPayloadV1> | undefined;
    const workId = payload?.workId;
    const orderId = payload?.orderId;

    if (
      typeof workId !== 'string' ||
      workId.length === 0 ||
      typeof orderId !== 'string' ||
      orderId.length === 0
    ) {
      // Terminal: a malformed payload throws identically on every attempt.
      this.logger.warn(
        `fulfillment.work.autoDispatch received a malformed payload: jobId=${job.id} ` +
          `connectionId=${job.connectionId}`
      );
      return null;
    }

    return { schemaVersion: 1, workId, orderId };
  }
}
