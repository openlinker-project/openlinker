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
import { Between, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { WebhookDeliveryOrmEntity } from '../entities/webhook-delivery.orm-entity';
import { WebhookDelivery } from '../../../domain/entities/webhook-delivery.entity';
import {
  WebhookDeliveryRepositoryPort,
  WebhookDeliveryUpsertInput,
} from '../../../domain/ports/webhook-delivery-repository.port';
import {
  PaginatedWebhookDeliveries,
  WebhookDedupResult,
  WebhookDedupResultValues,
  WebhookDeliveryFilters,
  WebhookDeliveryPagination,
  WebhookDeliveryStatus,
  WebhookDeliveryStatusValues,
} from '../../../domain/types/webhook-delivery.types';

@Injectable()
export class WebhookDeliveryRepository implements WebhookDeliveryRepositoryPort {
  constructor(
    @InjectRepository(WebhookDeliveryOrmEntity)
    private readonly repository: Repository<WebhookDeliveryOrmEntity>,
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
    if (input.publishedMessageId !== undefined) overlay.publishedMessageId = input.publishedMessageId;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
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
      throw new Error(
        `Upsert failed to locate row: provider=${input.provider}, connectionId=${input.connectionId}, eventId=${input.eventId}`,
      );
    }
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<WebhookDelivery | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findMany(
    filters: WebhookDeliveryFilters,
    pagination: WebhookDeliveryPagination,
  ): Promise<PaginatedWebhookDeliveries> {
    const where: FindOptionsWhere<WebhookDeliveryOrmEntity> = {};
    if (filters.provider) where.provider = filters.provider;
    if (filters.connectionId) where.connectionId = filters.connectionId;
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
      entity.updatedAt,
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
