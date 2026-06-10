/**
 * Inbound Routing Policy Service
 *
 * Maps a neutral `CanonicalInboundEvent` to a sync job and enqueues it,
 * gated on the connection's resolved capabilities (ADR-015). This is the
 * single place that decides "which job does this inbound event become?" —
 * a deterministic, platform-agnostic table keyed on the event's `domain`.
 * The inbound webhook dispatcher (`WebhookToJobHandler`) carries zero
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
import type { RoutingOutcome } from '../types/inbound-routing-policy.types';
import { JobEnqueuePort } from '../../domain/ports/job-enqueue.port';
import { JOB_ENQUEUE_TOKEN } from '../../sync.tokens';
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

  async route(
    event: CanonicalInboundEvent,
    connection: Connection,
    supportedCapabilities: readonly string[],
    sourceEventId: string
  ): Promise<RoutingOutcome> {
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

    const job: SyncJobRequest = {
      jobType,
      connectionId: connection.id,
      payload,
      idempotencyKey: `${connection.platformType}:${connection.id}:${sourceEventId}`,
    };
    const { jobId } = await this.jobEnqueue.enqueueJob(job);
    this.logger.log(
      `Routed inbound ${event.domain} event (externalId=${event.externalId}) for connection ` +
        `${connection.id} → ${jobType} (job ${jobId})`
    );
    return { status: 'enqueued', jobId, jobType };
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
