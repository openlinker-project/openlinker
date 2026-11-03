/**
 * Webhook Job Gate Service Interface
 *
 * The durable-spine gate (#2280, ADR-049 decision 1): writes the
 * `webhook_deliveries` gate row and — for a routed event — the `sync_jobs`
 * work row in ONE Postgres transaction, so the work is durable at hop one.
 * Redis is not involved on this path.
 *
 * Lives in the api host's webhooks layer by design: the transactional
 * composition crosses the webhooks/sync context boundary, which the issue
 * places in the host's infrastructure (ADR-049 decision 5 — no core `*Port`
 * ever carries an `EntityManager`).
 *
 * @module apps/api/src/webhooks/application/interfaces
 */
import type { SyncJobRequest } from '@openlinker/core/sync';
import type { WebhookDeliveryUpsertInput } from '@openlinker/core/webhooks';
import type { WebhookJobGateResult } from '../types/inbound-webhook-routing.types';

export const WEBHOOK_JOB_GATE_SERVICE_TOKEN = Symbol('IWebhookJobGateService');

export interface IWebhookJobGateService {
  /**
   * Atomically insert the delivery gate row and every work row in `jobs`, in
   * one transaction (an empty list = ping / dead-letter, delivery row only).
   * `jobs[0]` is the PRIMARY job: it is the one recorded in the delivery row's
   * single `downstreamJobId` slot and the one a dead-lettered row is repaired
   * to. Any later job is created alongside it and reported only in
   * `jobIds`. The delivery insert is the ADR-005 gate
   * (`ON CONFLICT ... DO NOTHING` on the event key); the job insert dedups on
   * `sync_jobs.idempotencyKey` with a real `ON CONFLICT DO NOTHING` +
   * in-transaction SELECT — never a caught constraint violation, which would
   * abort the surrounding transaction.
   *
   * The JOB is inserted first so the delivery row carries the real
   * `downstreamJobId` in its own INSERT — and so a replay whose original
   * delivery row survived without a job (the pre-upgrade `published` state)
   * self-heals the job even though the delivery insert then conflicts. On a
   * replay every job dedups on its own idempotency key, so a redelivery
   * creates nothing and returns the same ids.
   */
  insertDeliveryWithJobs(
    delivery: WebhookDeliveryUpsertInput,
    jobs: readonly SyncJobRequest[]
  ): Promise<WebhookJobGateResult>;
}
