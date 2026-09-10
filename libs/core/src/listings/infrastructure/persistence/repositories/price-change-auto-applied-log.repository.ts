/**
 * Price Change Auto-Applied Log Repository (#3144)
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {PriceChangeAutoAppliedLogRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
        oldAmount: String(input.oldAmount),
        newAmount: String(input.newAmount),
        currency: input.currency,
        appliedAt: input.appliedAt,
      })
    );
    return this.toDomain(saved);
  }

  async findRecent(limit: number): Promise<readonly PriceChangeAutoAppliedLogEntry[]> {
    const rows = await this.entries.find({
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
      Number(row.oldAmount),
      Number(row.newAmount),
      row.currency,
      new Date(row.appliedAt)
    );
  }
}
