/**
 * Webhook Job Gate Repository
 *
 * The transactional implementation of the durable webhook spine (#2280,
 * ADR-049 decision 1): one Postgres transaction inserting the
 * `webhook_deliveries` gate row and the `sync_jobs` work row together.
 *
 * Raw parameterized SQL, deliberately (the core webhook repository's own
 * precedent, #1511): the two tables belong to different core contexts, so an
 * ORM-entity composition here would couple the host to both contexts'
 * internals, while raw SQL against the documented column sets is pinned by
 * the webhook int-specs (the runner must execute the inserted row).
 *
 * Column notes (pre-implement gate findings):
 * - `createdAt`/`updatedAt` on BOTH tables come from TypeORM decorators
 *   (app-side), so the SQL sets them explicitly with `now()`.
 * - `sync_jobs.attempts/maxAttempts/nextRunAt` have DB defaults but are set
 *   explicitly anyway, mirroring `createIfNotExistsByIdempotencyKey`.
 *
 * @module apps/api/src/webhooks/infrastructure/persistence
 * @implements {IWebhookJobGateService}
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import type { SyncJobRequest } from '@openlinker/core/sync';
import type { WebhookDeliveryUpsertInput } from '@openlinker/core/webhooks';
import { Logger } from '@openlinker/shared/logging';
import type { IWebhookJobGateService } from '../../application/interfaces/webhook-job-gate.service.interface';
import type { WebhookJobGateResult } from '../../application/types/inbound-webhook-routing.types';

@Injectable()
export class WebhookJobGateRepository implements IWebhookJobGateService {
  private readonly logger = new Logger(WebhookJobGateRepository.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource
  ) {}

  async insertDeliveryWithJob(
    delivery: WebhookDeliveryUpsertInput,
    job: SyncJobRequest | null
  ): Promise<WebhookJobGateResult> {
    return this.dataSource.transaction(async (manager) => {
      // Job FIRST: the delivery row carries the real id, and a replay against
      // a job-less legacy row self-heals the job (interface docblock).
      const jobId = job ? await this.insertOrFindJob(manager, job) : null;

      const deliveryRows = await manager.query<Array<{ id: string }>>(
        `INSERT INTO webhook_deliveries
           ("eventId", "provider", "connectionId", "eventType", "objectType", "externalId",
            "receivedAt", "signatureValid", "dedupResult", "status",
            "downstreamJobId", "downstreamJobType", "dlqReason", "payload",
            "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), now())
         ON CONFLICT ("provider", "connectionId", "eventId") DO NOTHING
         RETURNING id`,
        [
          delivery.eventId,
          delivery.provider,
          delivery.connectionId,
          delivery.eventType ?? null,
          delivery.objectType ?? null,
          delivery.externalId ?? null,
          delivery.receivedAt ?? new Date(),
          delivery.signatureValid ?? null,
          delivery.dedupResult ?? null,
          delivery.status,
          jobId,
          job?.jobType ?? delivery.downstreamJobType ?? null,
          delivery.dlqReason ?? null,
          delivery.payload ? JSON.stringify(delivery.payload) : null,
        ]
      );

      const isNew = deliveryRows.length > 0;
      if (!isNew) {
        this.logger.debug(
          `Gate replay: delivery row exists for ${delivery.provider}/${delivery.connectionId}/${delivery.eventId}` +
            (jobId ? ` (job ${jobId} present)` : '')
        );
        if (jobId !== null) {
          await this.repairDeadLetteredRow(manager, delivery, jobId, job?.jobType ?? null);
        }
      }
      return { isNew, jobId };
    });
  }

  /**
   * Repair a `deadlettered` delivery row that a later redelivery HAS routed.
   *
   * The sequence this exists for is ordinary operator remediation: an event
   * arrives while its connection lacks the required capability, so it is
   * dead-lettered; the operator enables the capability; the source redelivers
   * the same `eventId`. Routing now succeeds and the job-first insert creates a
   * REAL job that runs — but the delivery insert conflicts, so without this the
   * row would keep saying `deadlettered` with a null `downstreamJobId`,
   * permanently contradicting a job that executed.
   *
   * It cannot self-heal through the ordinary #1916 upsert, because that ladder
   * ranks `deadlettered` (3) ABOVE `job_enqueued` (2) — deliberately, so a late
   * `published` write cannot erase a dead-letter. This is the one transition
   * where the demotion is correct, so it is written as an explicit, narrowly
   * targeted UPDATE (`WHERE status = 'deadlettered'`) inside the same
   * transaction rather than by weakening the rank guard for everyone.
   */
  private async repairDeadLetteredRow(
    manager: EntityManager,
    delivery: WebhookDeliveryUpsertInput,
    jobId: string,
    jobType: string | null
  ): Promise<void> {
    const repaired = (await manager.query<Array<{ id: string }>>(
      `UPDATE webhook_deliveries
          SET "status" = 'job_enqueued',
              "downstreamJobId" = $1,
              "downstreamJobType" = COALESCE($2, "downstreamJobType"),
              "dlqReason" = NULL,
              "updatedAt" = now()
        WHERE "provider" = $3 AND "connectionId" = $4 AND "eventId" = $5
          AND "status" = 'deadlettered'
        RETURNING id`,
      [jobId, jobType, delivery.provider, delivery.connectionId, delivery.eventId]
    )) as Array<{ id: string }>;

    if (repaired.length > 0) {
      this.logger.log(
        `Repaired dead-lettered delivery now routable: ${delivery.provider}/${delivery.connectionId}/${delivery.eventId} → job ${jobId}`
      );
    }
  }

  /**
   * `INSERT ... ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id`, with
   * an in-transaction SELECT on conflict. Transaction-safe by construction —
   * the catch-based dedup in `createIfNotExistsByIdempotencyKey` would abort
   * the surrounding transaction (gate finding).
   */
  private async insertOrFindJob(manager: EntityManager, job: SyncJobRequest): Promise<string> {
    const inserted = await manager.query<Array<{ id: string }>>(
      `INSERT INTO sync_jobs
         ("id", "jobType", "connectionId", "payloadJson", "status",
          "idempotencyKey", "attempts", "maxAttempts", "nextRunAt",
          "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'queued', $5, 0, 10, now(), now(), now())
       ON CONFLICT ("idempotencyKey") DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        job.jobType,
        job.connectionId,
        JSON.stringify(job.payload),
        job.idempotencyKey,
      ]
    );
    if (inserted.length > 0) {
      return inserted[0].id;
    }

    const existing = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM sync_jobs WHERE "idempotencyKey" = $1`,
      [job.idempotencyKey]
    );
    if (existing.length === 0) {
      // Unreachable outside a concurrent DELETE of the winning row; surfacing
      // beats inventing an id for a job that does not exist.
      throw new Error(
        `sync_jobs insert conflicted on idempotencyKey ${job.idempotencyKey} but no row was found`
      );
    }
    return existing[0].id;
  }
}
