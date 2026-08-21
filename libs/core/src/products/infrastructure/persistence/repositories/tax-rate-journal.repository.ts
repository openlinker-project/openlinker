/**
 * Tax-Rate Journal Repository (#2250)
 *
 * @module libs/core/src/products/infrastructure/persistence/repositories
 * @implements {TaxRateJournalRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TaxRateJournalOrmEntity } from '../entities/tax-rate-journal.orm-entity';
import type { TaxRateJournalRepositoryPort } from '../../../domain/ports/tax-rate-journal-repository.port';
import type {
  TaxRateJournalEntry,
  TaxRateJournalOrigin,
  TaxRateObservation,
} from '../../../domain/types/tax-rate-journal.types';

@Injectable()
export class TaxRateJournalRepository implements TaxRateJournalRepositoryPort {
  constructor(
    @InjectRepository(TaxRateJournalOrmEntity)
    private readonly repository: Repository<TaxRateJournalOrmEntity>
  ) {}

  async append(
    observation: TaxRateObservation & { observedAt: Date }
  ): Promise<TaxRateJournalEntry> {
    const entity = this.repository.create({
      productId: observation.productId,
      variantId: observation.variantId,
      connectionId: observation.connectionId,
      origin: observation.origin,
      taxRate: observation.taxRate,
      frozen: observation.frozen ?? false,
      observedAt: observation.observedAt,
    });
    return this.toDomain(await this.repository.save(entity));
  }

  async findLatest(
    productId: string,
    variantId: string | null,
    connectionId: string
  ): Promise<TaxRateJournalEntry | null> {
    const row = await this.repository.findOne({
      where: {
        productId,
        // `IsNull()` rather than `null`: TypeORM renders a bare null as
        // `= NULL`, which matches nothing, so a product-level entry would
        // never be found and every sync would append a duplicate.
        variantId: variantId === null ? IsNull() : variantId,
        connectionId,
      },
      order: { observedAt: 'DESC', createdAt: 'DESC' },
    });
    return row ? this.toDomain(row) : null;
  }

  /**
   * One row per connection, newest first.
   *
   * `DISTINCT ON` rather than a window function: it is the Postgres idiom for
   * "the latest per group" and reads straight off the same index the single
   * lookup uses.
   */
  async findLatestPerConnection(
    productId: string,
    variantId: string | null
  ): Promise<TaxRateJournalEntry[]> {
    // `query` is untyped by TypeORM, so the cast is the boundary where the raw
    // row shape is asserted once rather than at each field read below.
    const rows = (await this.repository.query(
      `SELECT DISTINCT ON ("connectionId") *
         FROM "tax_rate_journal"
        WHERE "productId" = $1
          AND "variantId" IS NOT DISTINCT FROM $2
        ORDER BY "connectionId", "observedAt" DESC, "createdAt" DESC`,
      [productId, variantId]
    )) as TaxRateJournalOrmEntity[];
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(entity: TaxRateJournalOrmEntity): TaxRateJournalEntry {
    return {
      id: entity.id,
      productId: entity.productId,
      variantId: entity.variantId,
      connectionId: entity.connectionId,
      origin: entity.origin as TaxRateJournalOrigin,
      taxRate: entity.taxRate,
      frozen: entity.frozen,
      observedAt: entity.observedAt,
      createdAt: entity.createdAt,
    };
  }
}
