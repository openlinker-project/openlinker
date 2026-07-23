/**
 * Webhook Auth Rejection Repository
 *
 * TypeORM-backed implementation of WebhookAuthRejectionRepositoryPort. Upserts
 * one rolling row per `(provider, connectionId)` on each signature-rejected
 * delivery, incrementing the counter and refreshing `lastRejectedAt`/`lastReason`.
 *
 * @module libs/core/src/webhooks/infrastructure/persistence/repositories
 * @implements {WebhookAuthRejectionRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookAuthRejectionOrmEntity } from '../entities/webhook-auth-rejection.orm-entity';
import { WebhookAuthRejection } from '../../../domain/entities/webhook-auth-rejection.entity';
import type {
  WebhookAuthRejectionRecordInput,
  WebhookAuthRejectionRepositoryPort,
} from '../../../domain/ports/webhook-auth-rejection-repository.port';

@Injectable()
export class WebhookAuthRejectionRepository implements WebhookAuthRejectionRepositoryPort {
  constructor(
    @InjectRepository(WebhookAuthRejectionOrmEntity)
    private readonly repository: Repository<WebhookAuthRejectionOrmEntity>
  ) {}

  async recordRejection(input: WebhookAuthRejectionRecordInput): Promise<void> {
    const rejectedAt = input.rejectedAt ?? new Date();
    const reason = input.reason ?? null;

    // Raw parameterized INSERT ... ON CONFLICT DO UPDATE (not TypeORM's
    // QueryBuilder). The lazy `require()` of InsertQueryBuilder can resolve to
    // `undefined` when invoked from the long-lived webhook request/consumer path
    // under jest's per-file module sandbox (#1511); a raw query sidesteps it.
    // On conflict we increment the rolling counter and refresh the last-seen
    // fields; `firstRejectedAt` is preserved. All values are bound parameters.
    await this.repository.query(
      `INSERT INTO webhook_auth_rejections
         ("provider", "connectionId", "rejectionCount", "firstRejectedAt", "lastRejectedAt", "lastReason")
       VALUES ($1, $2, 1, $3, $3, $4)
       ON CONFLICT ("provider", "connectionId")
       DO UPDATE SET
         "rejectionCount" = webhook_auth_rejections."rejectionCount" + 1,
         "lastRejectedAt" = EXCLUDED."lastRejectedAt",
         "lastReason" = EXCLUDED."lastReason",
         "updatedAt" = now()`,
      [input.provider, input.connectionId, rejectedAt, reason]
    );
  }

  async find(provider: string, connectionId: string): Promise<WebhookAuthRejection | null> {
    const entity = await this.repository.findOne({ where: { provider, connectionId } });
    return entity ? this.toDomain(entity) : null;
  }

  private toDomain(entity: WebhookAuthRejectionOrmEntity): WebhookAuthRejection {
    return new WebhookAuthRejection(
      entity.id,
      entity.provider,
      entity.connectionId,
      // `bigint` columns come back as strings from the pg driver — coerce the
      // small monotonic counter to a number for the domain.
      Number(entity.rejectionCount),
      entity.firstRejectedAt,
      entity.lastRejectedAt,
      entity.lastReason,
      entity.createdAt,
      entity.updatedAt
    );
  }
}
