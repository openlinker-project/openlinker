/**
 * Inbound Routing Policy Types
 *
 * Result of routing a `CanonicalInboundEvent` to a sync job (ADR-015).
 *
 * @module libs/core/src/sync/application/types
 */
import type { InboundEventDomain } from '@openlinker/core/integrations';
import type { JobType } from '../../domain/types/sync-job.types';

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
