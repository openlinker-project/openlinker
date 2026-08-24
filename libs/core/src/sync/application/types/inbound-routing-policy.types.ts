/**
 * Inbound Routing Policy Types
 *
 * Result of routing a `CanonicalInboundEvent` to a sync job (ADR-015).
 *
 * @module libs/core/src/sync/application/types
 */
import type { InboundEventDomain } from '@openlinker/core/integrations';
import type { JobType, SyncJobRequest } from '../../domain/types/sync-job.types';

/**
 * The PURE half of routing (#2280): the decision without the enqueue. A
 * `'resolved'` outcome carries the fully-built `SyncJobRequest` (jobType,
 * payload, idempotency key) so the caller can persist it inside its own
 * transaction — the durable-spine gate writes it in the same Postgres
 * transaction as the webhook_deliveries row (ADR-049 decision 1).
 */
export type InboundRouteResolution =
  | { status: 'resolved'; job: SyncJobRequest }
  | {
      status: 'ungated';
      domain: InboundEventDomain;
      /** Open-world capability — see the note on `RoutingOutcome` below. */
      requiredCapability: string;
    };

export type RoutingOutcome =
  | { status: 'enqueued'; jobId: string; jobType: JobType }
  | {
      status: 'ungated';
      domain: InboundEventDomain;
      // Open-world capability (#576): the well-known `CoreCapability` set plus
      // plugin-registered names like `ShippingProviderManager` (the `shipment`
      // domain's gate, #768), which lives as a string constant across the
      // shipping context rather than in `CoreCapabilityValues`. Typed `string`
      // to match `AdapterMetadata.supportedCapabilities` (also `string[]`).
      requiredCapability: string;
    };
