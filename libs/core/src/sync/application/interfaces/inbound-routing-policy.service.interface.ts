/**
 * Inbound Routing Policy Service Interface
 *
 * Core sync-orchestration policy that maps a neutral `CanonicalInboundEvent`
 * to a sync job, gated on the connection's resolved capabilities (ADR-015).
 * Deterministic `domain → required capability → jobType` routing; enqueues the
 * resulting job. The inbound webhook dispatcher delegates the "which job?"
 * decision here so no platform knowledge lives in the interface layer.
 *
 * @module libs/core/src/sync/application/interfaces
 */
import type { CanonicalInboundEvent } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { RoutingOutcome } from '../types/inbound-routing-policy.types';

export interface IInboundRoutingPolicyService {
  /**
   * Route a canonical inbound event to a sync job for the given connection.
   *
   * Gates on capability (the event's domain requires a specific capability to
   * be both adapter-supported and connection-enabled); on a passed gate the
   * job is enqueued and `{ status: 'enqueued' }` returned. On a failed gate no
   * job is enqueued and `{ status: 'ungated' }` is returned so the caller can
   * dead-letter.
   *
   * @param event - The neutral canonical inbound event (from a translator).
   * @param connection - The resolved source connection.
   * @param supportedCapabilities - The connection's adapter `supportedCapabilities`
   *   (resolved by the caller), the adapter-level half of the capability gate.
   * @param sourceEventId - The source webhook event id (idempotency + traceability).
   */
  route(
    event: CanonicalInboundEvent,
    connection: Connection,
    supportedCapabilities: readonly string[],
    sourceEventId: string
  ): Promise<RoutingOutcome>;
}
