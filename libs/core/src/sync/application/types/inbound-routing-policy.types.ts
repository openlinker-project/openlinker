/**
 * Inbound Routing Policy Types
 *
 * Result of routing a `CanonicalInboundEvent` to a sync job (ADR-015).
 *
 * @module libs/core/src/sync/application/types
 */
import type { CoreCapability, InboundEventDomain } from '@openlinker/core/integrations';
import type { JobType } from '../../domain/types/sync-job.types';

export type RoutingOutcome =
  | { status: 'enqueued'; jobId: string; jobType: JobType }
  | { status: 'ungated'; domain: InboundEventDomain; requiredCapability: CoreCapability };
