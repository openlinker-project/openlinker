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

export type InboundWebhookRoutingOutcome =
  /** Routed: the fully-built job spec, persisted by the gate transaction. */
  | { kind: 'routed'; job: SyncJobRequest }
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
  /** The `sync_jobs.id` (created or pre-existing) when a job spec was passed. */
  jobId: string | null;
}
