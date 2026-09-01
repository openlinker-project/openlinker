/**
 * Inbound Routing Policy Service
 *
 * Maps a neutral `CanonicalInboundEvent` to a sync job and enqueues it,
 * gated on the connection's resolved capabilities (ADR-015). This is the
 * single place that decides "which job does this inbound event become?" —
 * a deterministic, platform-agnostic table keyed on the event's `domain`.
 * The inbound webhook ingress (`InboundWebhookRoutingService` in `apps/api`,
 * since #2280 — previously the async `WebhookToJobHandler`) carries zero
 * platform knowledge and delegates here.
 *
 * Gate = the adapter's `supportedCapabilities` (passed in by the dispatcher,
 * which already resolved the connection's metadata) **and**
 * `connection.enabledCapabilities` (connection-level) — both pure reads, never
 * exception-as-control-flow — so a connection that supports but has disabled
 * the capability does not enqueue a job guaranteed to fail downstream. The
 * policy is a pure function of its inputs (no I/O beyond the enqueue).
 *
 * @module libs/core/src/sync/application/services
 * @implements {IInboundRoutingPolicyService}
 */
import { Injectable, Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { CanonicalInboundEvent } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { OrderFeedEventType } from '@openlinker/core/orders';
import type { IInboundRoutingPolicyService } from '../interfaces/inbound-routing-policy.service.interface';
import type {
  InboundRouteResolution,
  RoutingOutcome,
} from '../types/inbound-routing-policy.types';
import { JobEnqueuePort } from '../../domain/ports/job-enqueue.port';
import { JOB_ENQUEUE_TOKEN } from '../../sync.tokens';
import { buildInboundJobIdempotencyKey } from './inbound-job-idempotency-key';
import type { JobType, SyncJobRequest } from '../../domain/types/sync-job.types';
import type {
  MarketplaceOrderSyncPayloadV1,
  MarketplaceShipmentSyncByExternalIdPayloadV1,
} from '../../domain/types/marketplace-job-payloads.types';

/** Open-world shipping capability (#576) — the `shipment` domain's gate (#768). */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';
import type {
  MasterInventorySyncByExternalIdPayloadV1,
  MasterProductSyncByExternalIdPayloadV1,
} from '../../domain/types/master-job-payloads.types';
import type {
  PaymentStatusRefreshByExternalIdPayloadV1,
  RegulatoryStatusReconcilePayloadV1,
} from '../../domain/types/invoicing-job-payloads.types';
import type { FulfillmentWorkStatusSyncPayloadV1 } from '../../domain/types/fulfillment-job-payloads.types';
import type { MarketplaceReturnSyncPayloadV1 } from '../../domain/types/returns-job-payloads.types';

/**
 * Open-world OMS capability (#2403) — the `fulfillment` domain's gate (#2400).
 *
 * Named as a constant beside `SHIPPING_PROVIDER_MANAGER_CAPABILITY` rather than
 * inlined, for the same reason: it is a capability STRING, and the routing
 * table is the one place a typo in it would silently make every delivery
 * `ungated` instead of failing loudly.
 */
const FULFILLMENT_EXECUTOR_CAPABILITY = 'FulfillmentExecutor';

/**
 * Page size for the reconcile job a webhook-triggered `invoicing` event
 * enqueues. The webhook is a trigger, not the source of truth (#1281,
 * mirrors the InPost/webhook philosophy): it only shortens the latency
 * until the next scheduled reconcile drains the full non-terminal frontier.
 */
const INVOICING_WEBHOOK_RECONCILE_LIMIT = 50;

/**
 * Local mirror of the order-domain event vocabulary. `OrderFeedEventType` is
 * imported **type-only** (no runtime `@openlinker/core/orders` barrel load) so
 * the `sync` barrel doesn't gain a `sync → orders` value edge — the orders
 * barrel re-exports `OrdersModule`, which imports `SyncModule`, so a value
 * import here would close a runtime module cycle. `satisfies` guards drift:
 * removing a token upstream breaks this at compile time.
 */
const ORDER_FEED_EVENT_TYPES = [
  'created',
  'updated',
  'cancelled',
  'paid',
] as const satisfies readonly OrderFeedEventType[];

@Injectable()
export class InboundRoutingPolicyService implements IInboundRoutingPolicyService {
  private readonly logger = new Logger(InboundRoutingPolicyService.name);

  constructor(
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  resolve(
    event: CanonicalInboundEvent,
    connection: Connection,
    supportedCapabilities: readonly string[],
    sourceEventId: string
  ): InboundRouteResolution {
    const { jobType, requiredCapability, payload } = this.resolveRoute(event, sourceEventId);

    const supported = supportedCapabilities.includes(requiredCapability);
    const enabled = connection.enabledCapabilities.includes(requiredCapability);
    if (!supported || !enabled) {
      this.logger.warn(
        `Inbound ${event.domain} event for connection ${connection.id} ungated: ` +
          `requires ${requiredCapability} (supported=${supported}, enabled=${enabled})`
      );
      return { status: 'ungated', domain: event.domain, requiredCapability };
    }

    return {
      status: 'resolved',
      job: {
        jobType,
        connectionId: connection.id,
        payload,
        idempotencyKey: buildInboundJobIdempotencyKey(
          connection.platformType,
          connection.id,
          sourceEventId
        ),
      },
    };
  }

  async route(
    event: CanonicalInboundEvent,
    connection: Connection,
    supportedCapabilities: readonly string[],
    sourceEventId: string
  ): Promise<RoutingOutcome> {
    const resolution = this.resolve(event, connection, supportedCapabilities, sourceEventId);
    if (resolution.status === 'ungated') {
      return resolution;
    }

    const job: SyncJobRequest = resolution.job;
    const { jobId } = await this.jobEnqueue.enqueueJob(job);
    this.logger.log(
      `Routed inbound ${event.domain} event (externalId=${event.externalId}) for connection ` +
        `${connection.id} → ${job.jobType} (job ${jobId})`
    );
    return { status: 'enqueued', jobId, jobType: job.jobType };
  }

  /**
   * Deterministic `domain → { capability, jobType, payload }` routing table.
   * Payloads `satisfies` the existing job-payload contracts (verified against
   * the worker handlers): master jobs carry no `eventType`; only the order
   * payload consumes the (advisory) canonical `eventType`.
   */
  private resolveRoute(
    event: CanonicalInboundEvent,
    sourceEventId: string
  ): {
    jobType: JobType;
    requiredCapability: string;
    payload: SyncJobRequest['payload'];
  } {
    switch (event.domain) {
      case 'order':
        return {
          jobType: 'marketplace.order.sync',
          requiredCapability: 'OrderSource',
          payload: {
            schemaVersion: 1,
            externalOrderId: event.externalId,
            sourceEventId,
            eventType: this.toOrderFeedEventType(event.eventType),
            occurredAt: event.occurredAt,
          } satisfies MarketplaceOrderSyncPayloadV1,
        };
      case 'inventory':
        return {
          jobType: 'master.inventory.syncByExternalId',
          requiredCapability: 'InventoryMaster',
          payload: {
            schemaVersion: 1,
            externalId: event.externalId,
            objectType: 'Inventory',
          } satisfies MasterInventorySyncByExternalIdPayloadV1,
        };
      case 'product':
        return {
          jobType: 'master.product.syncByExternalId',
          requiredCapability: 'ProductMaster',
          payload: {
            schemaVersion: 1,
            externalId: event.externalId,
            objectType: 'Product',
          } satisfies MasterProductSyncByExternalIdPayloadV1,
        };
      case 'shipment':
        return {
          jobType: 'marketplace.shipment.syncByExternalId',
          requiredCapability: SHIPPING_PROVIDER_MANAGER_CAPABILITY,
          payload: {
            schemaVersion: 1,
            externalId: event.externalId,
          } satisfies MarketplaceShipmentSyncByExternalIdPayloadV1,
        };
      case 'invoicing':
        // No by-id job exists (or is needed) — a clearance-status webhook
        // (e.g. Infakt relaying a KSeF update) is a trigger, not the source
        // of truth. It nudges the existing page-scan reconciler rather than
        // inventing a by-id job; the scheduled run still drains the full
        // non-terminal frontier regardless.
        return {
          jobType: 'invoicing.regulatoryStatus.reconcile',
          requiredCapability: 'Invoicing',
          payload: {
            schemaVersion: 1,
            limit: INVOICING_WEBHOOK_RECONCILE_LIMIT,
          } satisfies RegulatoryStatusReconcilePayloadV1,
        };
      case 'invoice-payment':
        // A provider payment webhook (e.g. Infakt `invoice_marked_as_paid`) is a
        // trigger, not the source of truth (#1354): route a by-id refresh that
        // re-reads authoritative payment state for the named document rather than
        // trusting the webhook body. Distinct from the regulatory reconcile above
        // because a paid document is typically already regulatory-terminal and so
        // outside the regulatory frontier.
        return {
          jobType: 'invoicing.paymentStatus.refreshByExternalId',
          requiredCapability: 'Invoicing',
          payload: {
            schemaVersion: 1,
            externalInvoiceId: event.externalId,
          } satisfies PaymentStatusRefreshByExternalIdPayloadV1,
        };
      case 'fulfillment':
        // Webhook-as-trigger, authoritative pull (#904): the body is advisory,
        // so the payload carries a REFERENCE and the job re-reads. See
        // `FulfillmentWorkStatusSyncPayloadV1` for why it deliberately carries
        // no deltas — writing counters from a non-authoritative hint is the
        // failure this discipline exists to prevent.
        //
        // This arm resolved `ungated` on every shipped deployment until #2409,
        // because no adapter manifest advertised `FulfillmentExecutor`.
        // `openlinker.oms.v1` advertises it now, so the gate can bind — but only
        // on a connection whose operator has ALSO enabled the capability, which
        // is why an install that has not created an OMS connection is unchanged.
        return {
          jobType: 'fulfillment.work.statusSync',
          requiredCapability: FULFILLMENT_EXECUTOR_CAPABILITY,
          payload: {
            schemaVersion: 1,
            externalWorkId: event.externalId,
            sourceEventId,
            eventType: event.eventType,
            occurredAt: event.occurredAt,
          } satisfies FulfillmentWorkStatusSyncPayloadV1,
        };
      case 'return':
        // Routes to the EXISTING per-return child (#2330); no new return job.
        //
        // Gated on `OrderSource`, never `ReturnSourceReader` — see the union
        // member's comment for the #2085 reasoning. The cost of that correct
        // choice is that this gate is over-permissive in the other direction: a
        // plain `OrderSource` connection with no return reader passes it. That
        // is handled where it can be handled honestly, at the point the narrow
        // actually fails — `ReturnIngestionService` raises the named
        // `ReturnSourceNotReadableError` and the handler answers a TERMINAL
        // `business_failure` (ADR-007), rather than burning ten attempts on a
        // structural condition no retry can change.
        return {
          jobType: 'marketplace.return.sync',
          requiredCapability: 'OrderSource',
          payload: {
            schemaVersion: 1,
            externalReturnId: event.externalId,
            eventKey: sourceEventId,
            occurredAt: event.occurredAt,
          } satisfies MarketplaceReturnSyncPayloadV1,
        };
      default: {
        // Exhaustive — `domain` is a closed union; this guards future additions.
        const exhaustive: never = event.domain;
        throw new Error(`Unhandled inbound event domain: ${String(exhaustive)}`);
      }
    }
  }

  private toOrderFeedEventType(eventType: string): OrderFeedEventType {
    return (ORDER_FEED_EVENT_TYPES as readonly string[]).includes(eventType)
      ? (eventType as OrderFeedEventType)
      : 'updated';
  }
}
