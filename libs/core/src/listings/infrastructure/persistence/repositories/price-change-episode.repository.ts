/**
 * Price Change Episode Repository (#3142, ADR-072)
 *
 * Persistence for `price_change_episodes`. The `upsertOpen` write is raw SQL
 * (`INSERT ... ON CONFLICT DO UPDATE` against the PARTIAL unique index) for
 * the same reason `ReservationShortfallRepository.openEpisode` is: Postgres
 * will not infer a partial index for a conflict target expressed through the
 * ORM query builder.
 *
 * Direction/magnitude filtering (`PriceChangeEpisodeFilters.direction` /
 * `.magnitudeLargeOnly`) is applied in application code after the read,
 * because `deltaPct` is a DERIVED value (computed from `computedOldAmount` /
 * `computedNewAmount`, not a stored column) — the review queue is a bounded,
 * per-operator working set, not a page over a whole catalogue, so this is not
 * the "sargable predicate" concern `docs/engineering-standards.md § When A
 * Paginated Total Is Expensive` is about.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {PriceChangeEpisodeRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { PriceChangeEpisodeOrmEntity } from '../entities/price-change-episode.orm-entity';
import { PriceChangeEpisode } from '../../../domain/entities/price-change-episode.entity';
import type { PriceChangeEpisodeRepositoryPort } from '../../../domain/ports/price-change-episode-repository.port';
import type {
  PriceChangeEpisodeFilters,
  PriceChangeResolution,
  UpsertOpenPriceChangeEpisodeInput,
} from '../../../domain/types/price-change-episode.types';

@Injectable()
export class PriceChangeEpisodeRepository implements PriceChangeEpisodeRepositoryPort {
  constructor(
    @InjectRepository(PriceChangeEpisodeOrmEntity)
    private readonly episodes: Repository<PriceChangeEpisodeOrmEntity>
  ) {}

  async findById(id: string): Promise<PriceChangeEpisode | null> {
    const row = await this.episodes.findOne({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findOpenByKey(
    productVariantId: string,
    destinationConnectionId: string,
    sourceConnectionId: string
  ): Promise<PriceChangeEpisode | null> {
    const row = await this.episodes.findOne({
      where: { productVariantId, destinationConnectionId, sourceConnectionId, resolvedAt: IsNull() },
    });
    return row ? this.toDomain(row) : null;
  }

  async findLastResolvedByKey(
    productVariantId: string,
    destinationConnectionId: string,
    sourceConnectionId: string
  ): Promise<PriceChangeEpisode | null> {
    const row = await this.episodes.findOne({
      where: {
        productVariantId,
        destinationConnectionId,
        sourceConnectionId,
        resolvedAt: Not(IsNull()),
      },
      order: { resolvedAt: 'DESC' },
    });
    return row ? this.toDomain(row) : null;
  }

  async upsertOpen(
    input: UpsertOpenPriceChangeEpisodeInput
  ): Promise<{ episode: PriceChangeEpisode; wasRefresh: boolean }> {
    // Conflict target REPEATS the partial index's predicate — Postgres will
    // not infer a partial index otherwise.
    const rows = await this.raw<PriceChangeEpisodeOrmEntity & { wasInserted: boolean }>(
      `INSERT INTO "price_change_episodes"
         ("productVariantId", "destinationConnectionId", "sourceConnectionId",
          "sourceCurrency", "sourceOldAmount", "sourceNewAmount",
          "computedOldAmount", "computedNewAmount", "blockReason", "detectedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT ("productVariantId", "destinationConnectionId", "sourceConnectionId")
         WHERE "resolvedAt" IS NULL
         DO UPDATE SET
           "sourceNewAmount" = EXCLUDED."sourceNewAmount",
           "computedNewAmount" = EXCLUDED."computedNewAmount",
           "sourceCurrency" = EXCLUDED."sourceCurrency",
           "blockReason" = EXCLUDED."blockReason",
           "refreshedAt" = now(),
           "updatedAt" = now()
       RETURNING *, (xmax = 0) AS "wasInserted"`,
      [
        input.productVariantId,
        input.destinationConnectionId,
        input.sourceConnectionId,
        input.sourceCurrency,
        input.sourceOldAmount,
        input.sourceNewAmount,
        input.computedOldAmount,
        input.computedNewAmount,
        input.blockReason,
        input.detectedAt,
      ]
    );

    const row = rows[0];
    return { episode: this.toDomain(row), wasRefresh: row.wasInserted === false };
  }

  async findOpenForConnection(
    destinationConnectionId: string,
    filters?: PriceChangeEpisodeFilters
  ): Promise<readonly PriceChangeEpisode[]> {
    return this.findOpen({ ...filters, destinationConnectionId });
  }

  async findOpenAll(filters?: PriceChangeEpisodeFilters): Promise<readonly PriceChangeEpisode[]> {
    return this.findOpen(filters);
  }

  private async findOpen(
    filters?: PriceChangeEpisodeFilters
  ): Promise<readonly PriceChangeEpisode[]> {
    const qb = this.episodes
      .createQueryBuilder('e')
      .where('e.resolvedAt IS NULL')
      .orderBy('e.detectedAt', 'DESC');

    if (filters?.destinationConnectionId) {
      qb.andWhere('e.destinationConnectionId = :destinationConnectionId', {
        destinationConnectionId: filters.destinationConnectionId,
      });
    }
    if (filters?.sourceConnectionId) {
      qb.andWhere('e.sourceConnectionId = :sourceConnectionId', {
        sourceConnectionId: filters.sourceConnectionId,
      });
    }

    const rows = await qb.getMany();
    let episodes = rows.map((row) => this.toDomain(row));

    if (filters?.direction) {
      episodes = episodes.filter((e) => (e.deltaPct() > 0 ? 'up' : 'down') === filters.direction);
    }
    if (filters?.magnitudeLargeOnly) {
      episodes = episodes.filter((e) => e.isSteep());
    }

    return episodes;
  }

  async resolve(
    id: string,
    resolution: PriceChangeResolution,
    resolvedByUserId: string | null,
    manualPriceOverride: number | null,
    resolvedAt: Date
  ): Promise<boolean> {
    const result = await this.episodes.update(
      { id, resolvedAt: IsNull() },
      {
        resolution,
        resolvedByUserId,
        resolvedAt,
        manualPriceOverride: manualPriceOverride === null ? null : String(manualPriceOverride),
        manualPriceOverrideSetAt: manualPriceOverride === null ? null : resolvedAt,
      }
    );
    return (result.affected ?? 0) > 0;
  }

  async reopenIgnored(id: string): Promise<boolean> {
    // Guarded to only reverse an 'ignored' resolution — an already-published
    // price (accepted / accepted-custom) is never un-published by Undo.
    const result = await this.episodes.update(
      { id, resolution: 'ignored' as PriceChangeResolution, resolvedAt: Not(IsNull()) },
      { resolution: null, resolvedByUserId: null, resolvedAt: null }
    );
    return (result.affected ?? 0) > 0;
  }

  async countOpen(filters?: PriceChangeEpisodeFilters): Promise<number> {
    const episodes = await this.findOpen(filters);
    return episodes.length;
  }

  /**
   * Raw query, normalised to a row list. Copied from
   * `ReservationShortfallRepository.raw` — node-postgres surfaces a
   * data-modifying statement with `RETURNING` as `[rows, affectedCount]`.
   */
  private async raw<T>(sql: string, params: readonly unknown[]): Promise<T[]> {
    const reply = (await this.episodes.manager.query(sql, [...params])) as unknown;
    const outer = Array.isArray(reply) ? reply : [];
    return (Array.isArray(outer[0]) ? outer[0] : outer) as T[];
  }

  private toDomain(row: PriceChangeEpisodeOrmEntity): PriceChangeEpisode {
    return new PriceChangeEpisode(
      row.id,
      row.productVariantId,
      row.destinationConnectionId,
      row.sourceConnectionId,
      row.sourceCurrency,
      Number(row.sourceOldAmount),
      Number(row.sourceNewAmount),
      Number(row.computedOldAmount),
      Number(row.computedNewAmount),
      row.manualPriceOverride === null ? null : Number(row.manualPriceOverride),
      row.manualPriceOverrideSetAt === null ? null : new Date(row.manualPriceOverrideSetAt),
      row.blockReason,
      new Date(row.detectedAt),
      row.refreshedAt === null ? null : new Date(row.refreshedAt),
      row.resolvedAt === null ? null : new Date(row.resolvedAt),
      row.resolution,
      row.resolvedByUserId,
      new Date(row.createdAt),
      new Date(row.updatedAt)
    );
  }
}
