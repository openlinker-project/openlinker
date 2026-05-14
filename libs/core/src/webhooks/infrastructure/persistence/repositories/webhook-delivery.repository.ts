/**
 * Webhook Delivery Repository
 *
 * TypeORM-backed implementation of WebhookDeliveryRepositoryPort. Provides
 * upsert semantics keyed on (provider, connectionId, eventId) to close the
 * race between the webhook ingress service (inserts the initial row) and the
 * async webhook-to-job handler (links the downstream job id).
 *
 * @module libs/core/src/webhooks/infrastructure/persistence/repositories
 * @implements {WebhookDeliveryRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { FindOptionsWhere } from 'typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { WebhookDeliveryOrmEntity } from '../entities/webhook-delivery.orm-entity';
import { WebhookDelivery } from '../../../domain/entities/webhook-delivery.entity';
import { WebhookDeliveryUpsertFailedError } from '../../../domain/exceptions/webhook-delivery-upsert-failed.error';
import type {
  WebhookDeliveryInsertResult,
  WebhookDeliveryRepositoryPort,
  WebhookDeliveryUpsertInput,
} from '../../../domain/ports/webhook-delivery-repository.port';
import type {
  PaginatedWebhookDeliveries,
  WebhookDedupResult,
  WebhookDeliveryFilters,
  WebhookDeliveryPagination,
  WebhookDeliveryStatus,
} from '../../../domain/types/webhook-delivery.types';
import {
  WebhookDedupResultValues,
  WebhookDeliveryStatusValues,
} from '../../../domain/types/webhook-delivery.types';

@Injectable()
export class WebhookDeliveryRepository implements WebhookDeliveryRepositoryPort {
  constructor(
    @InjectRepository(WebhookDeliveryOrmEntity)
    private readonly repository: Repository<WebhookDeliveryOrmEntity>
  ) {}

  async upsert(input: WebhookDeliveryUpsertInput): Promise<WebhookDelivery> {
    const now = new Date();
    const values: Partial<WebhookDeliveryOrmEntity> = {
      eventId: input.eventId,
      provider: input.provider,
      connectionId: input.connectionId,
      receivedAt: input.receivedAt ?? now,
      status: input.status ?? 'received',
    };
    const overlay: Partial<WebhookDeliveryOrmEntity> = {};

    if (input.eventType !== undefined) overlay.eventType = input.eventType;
    if (input.objectType !== undefined) overlay.objectType = input.objectType;
    if (input.externalId !== undefined) overlay.externalId = input.externalId;
    if (input.signatureValid !== undefined) overlay.signatureValid = input.signatureValid;
    if (input.dedupResult !== undefined) overlay.dedupResult = input.dedupResult;
    if (input.rejectionReason !== undefined) overlay.rejectionReason = input.rejectionReason;
    if (input.publishedMessageId !== undefined)
      overlay.publishedMessageId = input.publishedMessageId;
    if (input.downstreamJobId !== undefined) overlay.downstreamJobId = input.downstreamJobId;
    if (input.downstreamJobType !== undefined) overlay.downstreamJobType = input.downstreamJobType;
    if (input.dlqReason !== undefined) overlay.dlqReason = input.dlqReason;
    if (input.payload !== undefined) overlay.payload = input.payload;
    if (input.status !== undefined) overlay.status = input.status;

    const updateKeys = Object.keys(overlay) as (keyof WebhookDeliveryOrmEntity)[];

    await this.repository
      .createQueryBuilder()
      .insert()
      .into(WebhookDeliveryOrmEntity)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- typeorm QueryBuilder `.values()` typing rejects the dynamic overlay-merge shape we build above
      .values({ ...values, ...overlay } as any)
      .orUpdate(updateKeys.length > 0 ? (updateKeys as string[]) : ['updatedAt'], [
        'provider',
        'connectionId',
        'eventId',
      ])
      .execute();

    const saved = await this.repository.findOne({
      where: {
        provider: input.provider,
        connectionId: input.connectionId,
        eventId: input.eventId,
      },
    });
    if (!saved) {
      throw new WebhookDeliveryUpsertFailedError(input.provider, input.connectionId, input.eventId);
    }
    return this.toDomain(saved);
  }

  async insertIfNew(input: WebhookDeliveryUpsertInput): Promise<WebhookDeliveryInsertResult> {
    const now = new Date();
    const row: Partial<WebhookDeliveryOrmEntity> = {
      eventId: input.eventId,
      provider: input.provider,
      connectionId: input.connectionId,
      eventType: input.eventType ?? null,
      objectType: input.objectType ?? null,
      externalId: input.externalId ?? null,
      receivedAt: input.receivedAt ?? now,
      signatureValid: input.signatureValid ?? null,
      dedupResult: input.dedupResult ?? null,
      status: input.status ?? 'received',
      rejectionReason: input.rejectionReason ?? null,
      publishedMessageId: input.publishedMessageId ?? null,
      downstreamJobId: input.downstreamJobId ?? null,
      downstreamJobType: input.downstreamJobType ?? null,
      dlqReason: input.dlqReason ?? null,
      payload: input.payload ?? null,
    };

    // INSERT ... ON CONFLICT DO NOTHING RETURNING *. Conflict → empty rows
    // array; success → one row returned. We then re-fetch on conflict to
    // hand back the existing row for the audit-trail logging in the service.
    const insertResult = await this.repository
      .createQueryBuilder()
      .insert()
      .into(WebhookDeliveryOrmEntity)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- typeorm QueryBuilder `.values()` typing rejects the dynamic partial shape we build above
      .values(row as any)
      .orIgnore()
      .returning('*')
      .execute();

    const inserted = (insertResult.raw as WebhookDeliveryOrmEntity[] | undefined)?.[0];
    if (inserted) {
      return { isNew: true, delivery: this.toDomain(inserted) };
    }

    const existing = await this.repository.findOne({
      where: {
        provider: input.provider,
        connectionId: input.connectionId,
        eventId: input.eventId,
      },
    });
    if (!existing) {
      // The INSERT reported a conflict but the row vanished before the SELECT
      // — race with `deleteByEventKey`. Treat as new from the caller's POV
      // and retry the insert path. Pragmatic for #711: rare, recovers cleanly.
      throw new WebhookDeliveryUpsertFailedError(
        input.provider,
        input.connectionId,
        input.eventId
      );
    }
    return { isNew: false, existing: this.toDomain(existing) };
  }

  async deleteByEventKey(
    provider: string,
    connectionId: string,
    eventId: string
  ): Promise<void> {
    await this.repository.delete({ provider, connectionId, eventId });
  }

  async findById(id: string): Promise<WebhookDelivery | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findMany(
    filters: WebhookDeliveryFilters,
    pagination: WebhookDeliveryPagination
  ): Promise<PaginatedWebhookDeliveries> {
    const where: FindOptionsWhere<WebhookDeliveryOrmEntity> = {};
    if (filters.provider) where.provider = filters.provider;
    if (filters.connectionId) where.connectionId = filters.connectionId;
    if (filters.eventType) where.eventType = filters.eventType;
    if (filters.status) where.status = filters.status;
    if (filters.since && filters.until) {
      where.receivedAt = Between(filters.since, filters.until);
    } else if (filters.since) {
      where.receivedAt = MoreThanOrEqual(filters.since);
    } else if (filters.until) {
      where.receivedAt = LessThanOrEqual(filters.until);
    }

    const [entities, total] = await this.repository.findAndCount({
      where,
      order: { receivedAt: 'DESC' },
      take: pagination.limit,
      skip: pagination.offset,
    });

    return { items: entities.map((e) => this.toDomain(e)), total };
  }

  private toDomain(entity: WebhookDeliveryOrmEntity): WebhookDelivery {
    return new WebhookDelivery(
      entity.id,
      entity.eventId,
      entity.provider,
      entity.connectionId,
      entity.eventType,
      entity.objectType,
      entity.externalId,
      entity.receivedAt,
      entity.signatureValid,
      this.toDedupResult(entity.dedupResult),
      this.toStatus(entity.status, entity.id),
      entity.rejectionReason,
      entity.publishedMessageId,
      entity.downstreamJobId,
      entity.downstreamJobType,
      entity.dlqReason,
      entity.payload,
      entity.createdAt,
      entity.updatedAt
    );
  }

  private toStatus(value: string, id: string): WebhookDeliveryStatus {
    if ((WebhookDeliveryStatusValues as readonly string[]).includes(value)) {
      return value as WebhookDeliveryStatus;
    }
    throw new Error(`Invalid WebhookDelivery status "${value}" on row ${id}`);
  }

  private toDedupResult(value: string | null): WebhookDedupResult | null {
    if (value === null) return null;
    if ((WebhookDedupResultValues as readonly string[]).includes(value)) {
      return value as WebhookDedupResult;
    }
    return null;
  }
}
