/**
 * Price Change Auto-Applied Log Repository (#3144)
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {PriceChangeAutoAppliedLogRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { PriceChangeAutoAppliedLogOrmEntity } from '../entities/price-change-auto-applied-log.orm-entity';
import { PriceChangeAutoAppliedLogEntry } from '../../../domain/entities/price-change-auto-applied-log-entry.entity';
import type { PriceChangeAutoAppliedLogRepositoryPort } from '../../../domain/ports/price-change-auto-applied-log-repository.port';
import type { RecordAutoAppliedPriceChangeInput } from '../../../domain/types/price-change-auto-applied-log.types';

@Injectable()
export class PriceChangeAutoAppliedLogRepository implements PriceChangeAutoAppliedLogRepositoryPort {
  constructor(
    @InjectRepository(PriceChangeAutoAppliedLogOrmEntity)
    private readonly entries: Repository<PriceChangeAutoAppliedLogOrmEntity>
  ) {}

  async record(
    input: RecordAutoAppliedPriceChangeInput
  ): Promise<PriceChangeAutoAppliedLogEntry> {
    const saved = await this.entries.save(
      this.entries.create({
        productVariantId: input.productVariantId,
        destinationConnectionId: input.destinationConnectionId,
        sourceConnectionId: input.sourceConnectionId,
        oldAmount: input.oldAmount === null ? null : String(input.oldAmount),
        newAmount: String(input.newAmount),
        currency: input.currency,
        appliedAt: input.appliedAt,
      })
    );
    return this.toDomain(saved);
  }

  async findRecent(
    limit: number,
    since?: Date
  ): Promise<readonly PriceChangeAutoAppliedLogEntry[]> {
    const rows = await this.entries.find({
      // #3161 review: no time bound at all meant the "went live automatically
      // recently" banner never cleared once a single automatic change had
      // ever happened, even after the operator switched every connection
      // back to manual. `since` is optional and additive — an omitted value
      // keeps the pre-existing "most recent N, unbounded" behavior for any
      // other caller.
      ...(since ? { where: { appliedAt: MoreThanOrEqual(since) } } : {}),
      order: { appliedAt: 'DESC' },
      take: limit,
    });
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: PriceChangeAutoAppliedLogOrmEntity): PriceChangeAutoAppliedLogEntry {
    return new PriceChangeAutoAppliedLogEntry(
      row.id,
      row.productVariantId,
      row.destinationConnectionId,
      row.sourceConnectionId,
      row.oldAmount === null ? null : Number(row.oldAmount),
      Number(row.newAmount),
      row.currency,
      new Date(row.appliedAt)
    );
  }
}
