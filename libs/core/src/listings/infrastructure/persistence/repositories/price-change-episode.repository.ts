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
 * `computedNewAmount`, not a stored column). This IS one of the shapes
 * `docs/engineering-standards.md § When A Paginated Total Is Expensive`
 * warns about — an unbounded per-install read (`findOpenAll`) that cannot
 * push a predicate into the index — and it is not yet bounded: pagination on
 * `findOpenForConnection` / `findOpenAll` is deferred to the #3162 HTTP
 * surface, which is where the limit/offset (or cursor) parameters belong once
 * an operator-facing page size is chosen. `countOpen` / `countOpenBySource`
 * are real SQL aggregates specifically so the badge/tab counters do not pay
 * that unbounded read's cost in the meantime.
 *
 * Every domain error thrown here follows `docs/engineering-standards.md §
 * Error Handling`: a raw `QueryFailedError` never crosses this port.
 * `PriceChangeEpisodeSupersededError` names the one race that is a normal,
 * anticipated outcome (Undo racing a re-detection); everything else collapses
 * to the generic `PriceChangeEpisodePersistenceError`, mirroring
 * `RoutingDecisionRepository` / `FulfillmentPersistenceError`.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {PriceChangeEpisodeRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, QueryFailedError, Repository, type SelectQueryBuilder } from 'typeorm';
import { PriceChangeEpisodeOrmEntity } from '../entities/price-change-episode.orm-entity';
import { PriceChangeEpisode } from '../../../domain/entities/price-change-episode.entity';
import { PriceChangeEpisodePersistenceError } from '../../../domain/exceptions/price-change-episode-persistence.error';
import { PriceChangeEpisodeSupersededError } from '../../../domain/exceptions/price-change-episode-superseded.error';
import type { PriceChangeEpisodeRepositoryPort } from '../../../domain/ports/price-change-episode-repository.port';
import type {
  PriceChangeEpisodeFilters,
  PriceChangeResolution,
  UpsertOpenPriceChangeEpisodeInput,
} from '../../../domain/types/price-change-episode.types';

/** PostgreSQL `unique_violation`. Matched by code, never by message. */
const PG_UNIQUE_VIOLATION = '23505';

/** The partial index `reopenIgnored` can collide with. */
const OPEN_EPISODE_CONSTRAINT = 'UQ_price_change_episodes_open';

/**
 * How long an `ignored` episode stays visible to the review-queue list read
 * after resolution, so the operator-facing Undo affordance is reachable
 * (#3162 review — `findOpen`'s previous `WHERE resolvedAt IS NULL` meant a
 * listed item's `resolution` was ALWAYS `null`, so a client could never
 * render/trigger Undo at all; the mockup shows the just-ignored row
 * "greyed, on screen" with an Undo action). Deliberately short: this is a
 * recent-action affordance, not a resolved-episode history browser — a
 * `PriceChangeEpisodeSupersededError` (a rival episode reopened for the same
 * key since) becomes steadily more likely for an older row.
 */
const RECENTLY_IGNORED_WINDOW_MS = 15 * 60 * 1000;

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

  async findByIds(ids: readonly string[]): Promise<readonly PriceChangeEpisode[]> {
    if (ids.length === 0) return [];
    const rows = await this.episodes.find({ where: { id: In([...ids]) } });
    return rows.map((row) => this.toDomain(row));
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
    try {
      // Conflict target REPEATS the partial index's predicate — Postgres will
      // not infer a partial index otherwise.
      //
      // `sourceOldAmount` / `computedOldAmount` / `detectedAt` are
      // DELIBERATELY absent from the DO UPDATE SET list — the write set IS
      // the contract (see the port docblock): they pin the episode's
      // ORIGINAL detection for its whole life.
      //
      // `refreshedAt` is stamped conditionally — only when the conflict arm's
      // incoming `sourceNewAmount` genuinely differs from what is already
      // stored — never unconditionally on every conflict. An unconditional
      // stamp would flag a row as needing operator re-review on a
      // re-detection that repeated the same price (e.g. the same source
      // price re-observed on the next poll), and nothing ever clears the
      // column while the episode stands open, so that would have made the
      // row permanently (and wrongly) unactionable downstream (#3162 /
      // #3164 read `refreshedAt !== null` as "needs refresh").
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
             "refreshedAt" = CASE
               WHEN "price_change_episodes"."sourceNewAmount" IS DISTINCT FROM EXCLUDED."sourceNewAmount"
               THEN now()
               ELSE "price_change_episodes"."refreshedAt"
             END,
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

      if (rows.length === 0) {
        throw new PriceChangeEpisodePersistenceError(
          'upsertOpen',
          new Error('INSERT ... ON CONFLICT DO UPDATE RETURNING * produced no row')
        );
      }

      const row = rows[0];
      return { episode: this.toDomain(row), wasRefresh: row.wasInserted === false };
    } catch (error) {
      if (error instanceof PriceChangeEpisodePersistenceError) {
        throw error;
      }
      throw new PriceChangeEpisodePersistenceError('upsertOpen', error);
    }
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

  private buildOpenQuery(
    filters?: PriceChangeEpisodeFilters
  ): SelectQueryBuilder<PriceChangeEpisodeOrmEntity> {
    const qb = this.episodes.createQueryBuilder('e').where('e.resolvedAt IS NULL');

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

    return qb;
  }

  /**
   * The review-queue LIST base query — distinct from `buildOpenQuery` (used
   * by `countOpen`/`countOpenBySource`/`resolve`, which must stay strictly
   * "open" — a badge counter including a resolved row would over-report).
   *
   * When `includeRecentlyResolved` is set, widens the predicate to also
   * surface a recently-`ignored` episode so Undo is reachable (see
   * `RECENTLY_IGNORED_WINDOW_MS`).
   */
  private buildListQuery(
    filters?: PriceChangeEpisodeFilters
  ): SelectQueryBuilder<PriceChangeEpisodeOrmEntity> {
    const qb = this.episodes.createQueryBuilder('e');

    if (filters?.includeRecentlyResolved) {
      qb.where(
        '(e.resolvedAt IS NULL OR (e.resolution = :ignoredResolution AND e.resolvedAt >= :recentlyResolvedSince))',
        {
          ignoredResolution: 'ignored',
          recentlyResolvedSince: new Date(Date.now() - RECENTLY_IGNORED_WINDOW_MS),
        }
      );
    } else {
      qb.where('e.resolvedAt IS NULL');
    }

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

    return qb;
  }

  private async findOpen(
    filters?: PriceChangeEpisodeFilters
  ): Promise<readonly PriceChangeEpisode[]> {
    const qb = this.buildListQuery(filters).orderBy('e.detectedAt', 'DESC');

    // Bounded SQL page (#3162 review — this read previously hydrated the
    // WHOLE open set on every call, which is unbounded at catalogue scale).
    // `direction`/`magnitudeLargeOnly` are non-sargable (derived from
    // `deltaPct`, not a stored column) and stay APPLICATION-CODE post-filters
    // over this page — a page may therefore legitimately come back with
    // fewer than `limit` visible rows when either is active, the same
    // approximation `countOpen` already accepts for these two filters.
    if (filters?.limit !== undefined) {
      qb.take(filters.limit);
      qb.skip(filters.offset ?? 0);
    }

    const rows = await qb.getMany();
    let episodes = rows.map((row) => this.toDomain(row));

    if (filters?.direction) {
      // A `null` deltaPct (no baseline recorded yet — a brand-new mapping's
      // first detection) is an UNKNOWN direction, matched by neither 'up'
      // nor 'down' (#3159 review) — never defaulted to 'down' by treating
      // `null > 0` as false.
      episodes = episodes.filter((e) => {
        const delta = e.deltaPct();
        return delta !== null && (delta > 0 ? 'up' : 'down') === filters.direction;
      });
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
    try {
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
    } catch (error) {
      throw new PriceChangeEpisodePersistenceError('resolve', error);
    }
  }

  async reopenIgnored(id: string): Promise<boolean> {
    try {
      // Guarded to only reverse an 'ignored' resolution — an already-published
      // price (accepted / accepted-custom) is never un-published by Undo.
      //
      // The `NOT EXISTS` conjunct is the primary defense against the race
      // documented on `PriceChangeEpisodeSupersededError`: an operator
      // ignores episode E, E leaves `UQ_price_change_episodes_open`, a later
      // detection opens a fresh episode F for the SAME key, and only then
      // does the operator click Undo on E. Without the conjunct this UPDATE
      // would set E.resolvedAt back to NULL while F is already open for the
      // same key, violating the partial unique index (raised as a raw 23505
      // with no `try`/`catch` around it). The conjunct closes the common
      // (non-racy) ordering; the `catch` below closes the residual race where
      // a concurrent `upsertOpen` commits between this statement's
      // `NOT EXISTS` check and Postgres re-checking the unique index against
      // the row this UPDATE is about to write (index enforcement always uses
      // the latest committed state, not this statement's own snapshot).
      const rows = await this.raw<{ id: string }>(
        `UPDATE "price_change_episodes"
            SET "resolution" = NULL, "resolvedByUserId" = NULL, "resolvedAt" = NULL, "updatedAt" = now()
          WHERE "id" = $1
            AND "resolution" = 'ignored'
            AND "resolvedAt" IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "price_change_episodes" AS "riv"
               WHERE "riv"."productVariantId" = "price_change_episodes"."productVariantId"
                 AND "riv"."destinationConnectionId" = "price_change_episodes"."destinationConnectionId"
                 AND "riv"."sourceConnectionId" = "price_change_episodes"."sourceConnectionId"
                 AND "riv"."resolvedAt" IS NULL
            )
          RETURNING "id"`,
        [id]
      );
      return rows.length > 0;
    } catch (error) {
      if (this.isUniqueViolationOn(error, OPEN_EPISODE_CONSTRAINT)) {
        throw new PriceChangeEpisodeSupersededError(id);
      }
      throw new PriceChangeEpisodePersistenceError('reopenIgnored', error);
    }
  }

  async acknowledgeRefresh(id: string): Promise<PriceChangeEpisode | null> {
    try {
      const rows = await this.raw<PriceChangeEpisodeOrmEntity>(
        `UPDATE "price_change_episodes"
            SET "refreshedAt" = NULL, "updatedAt" = now()
          WHERE "id" = $1
            AND "resolvedAt" IS NULL
          RETURNING *`,
        [id]
      );
      return rows.length > 0 ? this.toDomain(rows[0]) : null;
    } catch (error) {
      throw new PriceChangeEpisodePersistenceError('acknowledgeRefresh', error);
    }
  }

  async countOpen(filters?: PriceChangeEpisodeFilters): Promise<number> {
    // `direction` / `magnitudeLargeOnly` are derived from `deltaPct`, which is
    // computed in application code (not a stored column, not sargable) — see
    // this file's header. Those two predicates fall back to a full read;
    // every other (sargable) combination gets a real SQL `COUNT`, which is
    // what the badge/tab counters this method backs actually need.
    if (filters?.direction || filters?.magnitudeLargeOnly) {
      const episodes = await this.findOpen(filters);
      return episodes.length;
    }

    try {
      return await this.buildOpenQuery(filters).getCount();
    } catch (error) {
      throw new PriceChangeEpisodePersistenceError('countOpen', error);
    }
  }

  async countOpenBySource(
    destinationConnectionId: string
  ): Promise<ReadonlyMap<string, number>> {
    try {
      const rows = await this.episodes
        .createQueryBuilder('e')
        .select('e.sourceConnectionId', 'sourceConnectionId')
        .addSelect('COUNT(*)', 'count')
        .where('e.resolvedAt IS NULL')
        .andWhere('e.destinationConnectionId = :destinationConnectionId', {
          destinationConnectionId,
        })
        .groupBy('e.sourceConnectionId')
        .getRawMany<{ sourceConnectionId: string; count: string }>();

      return new Map(rows.map((row) => [row.sourceConnectionId, Number(row.count)]));
    } catch (error) {
      throw new PriceChangeEpisodePersistenceError('countOpenBySource', error);
    }
  }

  /**
   * Matches the SQLSTATE **and** the constraint name — copied from
   * `RoutingDecisionRepository.isUniqueViolationOn` (#2392's rule): this
   * table carries more than one unique constraint (the primary key and the
   * open-episode index), so catching every `23505` would report a PK
   * collision as "a newer episode already exists", naming a constraint that
   * did not fail.
   */
  private isUniqueViolationOn(error: unknown, constraint: string): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const readString = (source: unknown, key: 'code' | 'constraint'): string | undefined => {
      if (typeof source !== 'object' || source === null) return undefined;
      const value = (source as Record<string, unknown>)[key];
      return typeof value === 'string' ? value : undefined;
    };
    const driverError = (error as { driverError?: unknown }).driverError;
    const code = readString(error, 'code') ?? readString(driverError, 'code');
    const name = readString(error, 'constraint') ?? readString(driverError, 'constraint');
    return code === PG_UNIQUE_VIOLATION && name === constraint;
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
      row.computedOldAmount === null ? null : Number(row.computedOldAmount),
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
