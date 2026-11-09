/**
 * Channel Quantity Push Repository (#4062)
 *
 * TypeORM implementation of `ChannelQuantityPushRepositoryPort`. Append-only:
 * nothing here updates a row, and the only delete is the retention prune.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ChannelQuantityPushRepositoryPort } from '../../../domain/ports/channel-quantity-push-repository.port';
import {
  ChannelQuantityPushOutcomeValues,
  type AppendChannelQuantityPushInput,
  type ChannelQuantityPush,
  type ChannelQuantityPushOutcome,
  type LastChannelQuantityPush,
} from '../../../domain/types/channel-quantity-push.types';
import { ChannelQuantityPushOrmEntity } from '../entities/channel-quantity-push.orm-entity';

const TABLE = '"channel_quantity_pushes"';

/** A value this build does not know reads as `failed`, never as a success. */
function toOutcome(value: string): ChannelQuantityPushOutcome {
  return (ChannelQuantityPushOutcomeValues as readonly string[]).includes(value)
    ? (value as ChannelQuantityPushOutcome)
    : 'failed';
}

interface LatestRawRow {
  productVariantId: string;
  connectionId: string;
  quantity: number | null;
  outcome: string;
  pushedAt: Date;
}

@Injectable()
export class ChannelQuantityPushRepository implements ChannelQuantityPushRepositoryPort {
  constructor(
    @InjectRepository(ChannelQuantityPushOrmEntity)
    private readonly repository: Repository<ChannelQuantityPushOrmEntity>
  ) {}

  async appendMany(inputs: readonly AppendChannelQuantityPushInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await this.repository.insert(
      inputs.map((input) => ({
        connectionId: input.connectionId,
        externalOfferId: input.externalOfferId,
        productVariantId: input.productVariantId,
        quantity: input.quantity,
        outcome: input.outcome,
        errorCode: input.errorCode,
        message: input.message,
        observedAt: input.observedAt,
        pushedAt: input.pushedAt,
      }))
    );
  }

  async findForObservation(productVariantId: string, observedAt: Date): Promise<ChannelQuantityPush[]> {
    const rows = await this.repository.find({
      where: { productVariantId, observedAt },
      order: { pushedAt: 'ASC' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  async findLatestByVariantIds(
    productVariantIds: readonly string[]
  ): Promise<LastChannelQuantityPush[]> {
    if (productVariantIds.length === 0) return [];
    const rows = (await this.repository.query(
      `SELECT DISTINCT ON ("productVariantId", "connectionId")
              "productVariantId", "connectionId", "quantity", "outcome", "pushedAt"
       FROM ${TABLE}
       WHERE "productVariantId" = ANY($1)
       ORDER BY "productVariantId", "connectionId", "pushedAt" DESC`,
      [productVariantIds]
    )) as LatestRawRow[];
    return rows.map((row) => ({
      productVariantId: row.productVariantId,
      connectionId: row.connectionId,
      quantity: row.quantity,
      outcome: toOutcome(row.outcome),
      pushedAt: new Date(row.pushedAt),
    }));
  }

  async pruneOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new Error('pruneOlderThan: batchSize must be a positive integer');
    }
    const result = (await this.repository.query(
      `DELETE FROM ${TABLE}
       WHERE "id" IN (
         SELECT "id" FROM ${TABLE}
         WHERE "pushedAt" < $1
         ORDER BY "pushedAt" ASC
         LIMIT $2
       )`,
      [cutoff, batchSize]
    )) as [unknown[], number];
    return result[1] ?? 0;
  }

  private toDomain(row: ChannelQuantityPushOrmEntity): ChannelQuantityPush {
    return {
      id: row.id,
      connectionId: row.connectionId,
      externalOfferId: row.externalOfferId,
      productVariantId: row.productVariantId,
      quantity: row.quantity,
      outcome: toOutcome(row.outcome),
      errorCode: row.errorCode,
      message: row.message,
      observedAt: row.observedAt,
      pushedAt: row.pushedAt,
    };
  }
}
