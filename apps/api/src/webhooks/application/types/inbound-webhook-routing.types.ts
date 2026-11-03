/**
 * Inbound Webhook Routing Types
 *
 * Outcomes of resolving a verified inbound webhook to a sync job at ingress
 * (#2280, ADR-049 decision 1). The previously-async DLQ branches of the
 * retired stream consumer become durable, deterministic outcomes here.
 *
 * @module apps/api/src/webhooks/application/types
 */
import type { SyncJobRequest } from '@openlinker/core/sync';

/**
 * The jobs one delivery became - never empty, so a consumer can read `[0]`
 * (the PRIMARY job, the one recorded on the delivery row) without a guard.
 */
export type RoutedInboundJobs = readonly [SyncJobRequest, ...SyncJobRequest[]];

export type InboundWebhookRoutingOutcome =
  /**
   * Routed: the fully-built job specs, persisted by the gate transaction. One
   * per resolvable canonical event the translator returned, primary first.
   */
  | { kind: 'routed'; jobs: RoutedInboundJobs }
  /** `test.*` verification ping — record the delivery, create no job. */
  | { kind: 'ping' }
  /**
   * Deterministically unroutable (no translator / undecodable / ungated /
   * connection-unavailable) — recorded as a `deadlettered` delivery row.
   * Retrying cannot change these, so no error is thrown; transient failures
   * (DB blip during adapter resolve) DO throw and reach the source's retry.
   */
  | { kind: 'unroutable'; reason: string };

/** Result of the transactional gate write (#2280). */
export interface WebhookJobGateResult {
  /**
   * False = the delivery row already existed (replay) — the ADR-005 idempotent
   * 202; nothing further was written by this call except a possible job
   * self-heal (see the gate's job-first insert order).
   */
  isNew: boolean;
  /**
   * The PRIMARY job's `sync_jobs.id` (created or pre-existing) when at least
   * one job spec was passed - always `jobIds[0]`, kept for callers that only
   * ever dealt in one job.
   */
  jobId: string | null;
  /** Every job's id, in the order the specs were passed. Empty for ping / unroutable. */
  jobIds: string[];
}
