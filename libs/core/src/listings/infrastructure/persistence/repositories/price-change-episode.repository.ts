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
 * `.magnitudeLargeOnly`) is a real SQL `WHERE` predicate (#3162 re-review,
 * BLOCKING), reproducing `PriceChangeEpisode.direction()` / `.isSteep()` as
 * SQL expressions over the two stored amount columns. An EARLIER revision
 * took the SQL page first and applied these two as an application-code
 * post-filter over the already-paged rows — which silently walked `offset`
 * over UNFILTERED space (so paging a filtered queue skipped/repeated rows
 * arbitrarily) and capped `countOpen`'s fallback (`findOpen(filters).length`)
 * at the page size, so `total` could never exceed `limit` while a direction
 * filter was active. The docblock justified this as "non-sargable" — which
 * means "cannot use an index", not "inexpressible in SQL": `deltaPct` is
 * plain arithmetic over two stored, indexed-adjacent columns
 * (`computedNewAmount`, `computedOldAmount`), so both predicates belong in
 * the `WHERE` clause, correctly-if-slowly, per
 * `docs/engineering-standards.md § When A Paginated Total Is Expensive`
 * ("correctness first, then an index or the `withTotal` opt-out"). See
 * `applyDerivedFilters` below.
 *
 * `countOpen` is consequently a real SQL `COUNT` for every filter
 * combination, with no page-length fallback of any kind.
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
  PriceChangeEpisodeClaimOutcome,
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
    this.applyConnectionFilters(qb, filters);
    this.applyDerivedFilters(qb, filters);
    return qb;
  }

  private applyConnectionFilters(
    qb: SelectQueryBuilder<PriceChangeEpisodeOrmEntity>,
    filters?: PriceChangeEpisodeFilters
  ): void {
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
  }

  /**
   * `direction`/`magnitudeLargeOnly` as SQL, reproducing
   * `PriceChangeEpisode.direction()`/`.isSteep()` exactly (#3162 re-review,
   * BLOCKING) so the SAME row set is what both the page and the count agree
   * on — shared by `buildOpenQuery` (strictly-open: `countOpen`) and
   * `buildListQuery` (the review-queue list read, `findOpen`).
   *
   * `direction()`: `'unknown'` when `computedOldAmount IS NULL` (no
   * baseline), otherwise `'up'` when `computedNewAmount >= computedOldAmount`
   * else `'down'` — never derived from `deltaPct() > 0`, which the entity's
   * own docblock records as wrong for a `0 -> N` increase.
   *
   * `isSteep()`: `|deltaPct()| >= 10`, where `deltaPct()` is `null` (never
   * steep) when there is no baseline, `0` (never steep) when the baseline is
   * exactly zero, and otherwise `round(((new - old) / old) * 1000) / 10` —
   * reproduced here with the same `ROUND`/division order so the SQL and the
   * entity method can never disagree on which side of the threshold a row
   * falls.
   */
  private applyDerivedFilters(
    qb: SelectQueryBuilder<PriceChangeEpisodeOrmEntity>,
    filters?: PriceChangeEpisodeFilters
  ): void {
    if (filters?.direction) {
      qb.andWhere(
        `CASE
           WHEN e."computedOldAmount" IS NULL THEN 'unknown'
           WHEN e."computedNewAmount" >= e."computedOldAmount" THEN 'up'
           ELSE 'down'
         END = :direction`,
        { direction: filters.direction }
      );
    }
    if (filters?.magnitudeLargeOnly) {
      qb.andWhere(
        `e."computedOldAmount" IS NOT NULL
         AND e."computedOldAmount" <> 0
         AND ABS(ROUND(((e."computedNewAmount" - e."computedOldAmount") / e."computedOldAmount") * 1000) / 10) >= 10`
      );
    }
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

    this.applyConnectionFilters(qb, filters);
    this.applyDerivedFilters(qb, filters);

    return qb;
  }

  private async findOpen(
    filters?: PriceChangeEpisodeFilters
  ): Promise<readonly PriceChangeEpisode[]> {
    const qb = this.buildListQuery(filters).orderBy('e.detectedAt', 'DESC');

    // Bounded SQL page (#3162 review — this read previously hydrated the
    // WHOLE open set on every call, which is unbounded at catalogue scale).
    // `direction`/`magnitudeLargeOnly` are now pushed into the SAME query via
    // `applyDerivedFilters` (#3162 re-review, BLOCKING — see this file's
    // header), so `limit`/`offset` walk the fully-filtered set and a page
    // always returns up to `limit` MATCHING rows, never fewer because a
    // post-filter thinned an already-paged batch.
    if (filters?.limit !== undefined) {
      qb.take(filters.limit);
      qb.skip(filters.offset ?? 0);
    }

    const rows = await qb.getMany();
    return rows.map((row) => this.toDomain(row));
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
    // A real SQL `COUNT` over every filter, `direction`/`magnitudeLargeOnly`
    // included (#3162 re-review, BLOCKING) — both query builders push these
    // into the `WHERE` clause via `applyDerivedFilters`, so this can no
    // longer fall back to `findOpen(filters).length` (which silently capped
    // the reported total at `filters.limit` whenever a direction filter was
    // active — see this file's header).
    //
    // `includeRecentlyResolved` selects WHICH base predicate is counted
    // (#3162 re-review, IMPORTANT — "`total`, `items` and `hiddenStaleCount`
    // describe three different sets"): the review-queue list read
    // (`PriceChangesService.listOpen`) always passes
    // `includeRecentlyResolved: true` on its `total` call, so it must count
    // over `buildListQuery` — the SAME predicate `findOpen` reads its page
    // from — or `total` under-counts every recently-ignored row the page
    // legitimately renders (the Undo affordance, #3162). Every OTHER caller
    // (badge/tab counters via `PriceChangesService.countOpen`,
    // `countOpenBySource`) never sets the flag and keeps the strictly-open
    // count `buildOpenQuery` has always produced.
    try {
      const qb = filters?.includeRecentlyResolved
        ? this.buildListQuery(filters)
        : this.buildOpenQuery(filters);
      return await qb.getCount();
    } catch (error) {
      throw new PriceChangeEpisodePersistenceError('countOpen', error);
    }
  }

  async claimForResolution(
    id: string,
    claimedAt: Date
  ): Promise<PriceChangeEpisodeClaimOutcome> {
    try {
      const rows = await this.raw<{ id: string }>(
        `UPDATE "price_change_episodes"
            SET "claimedAt" = $2, "updatedAt" = now()
          WHERE "id" = $1
            AND "resolvedAt" IS NULL
            AND "claimedAt" IS NULL
          RETURNING "id"`,
        [id, claimedAt]
      );
      if (rows.length > 0) {
        return 'claimed';
      }

      // Losing side of a race — cheap to re-read, since this only happens
      // when a peer already holds (or resolved) the claim.
      const row = await this.episodes.findOne({
        where: { id },
        select: ['id', 'resolvedAt', 'claimedAt'],
      });
      if (!row) return 'not-found';
      if (row.resolvedAt !== null) return 'resolved';
      return 'in-flight';
    } catch (error) {
      throw new PriceChangeEpisodePersistenceError('claimForResolution', error);
    }
  }

  async releaseClaim(id: string): Promise<void> {
    try {
      // Idempotent and unconditional on the CURRENT `claimedAt` value — a
      // no-op release (already `null`) is harmless, and `resolvedAt IS NULL`
      // is enough to keep this from ever touching a resolved row (whose
      // claim is moot regardless).
      await this.episodes.update({ id, resolvedAt: IsNull() }, { claimedAt: null });
    } catch (error) {
      throw new PriceChangeEpisodePersistenceError('releaseClaim', error);
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

  async listOpenDestinationConnectionIds(sourceConnectionId: string): Promise<readonly string[]> {
    try {
      const rows = await this.episodes
        .createQueryBuilder('e')
        .select('DISTINCT e.destinationConnectionId', 'destinationConnectionId')
        .where('e.resolvedAt IS NULL')
        .andWhere('e.sourceConnectionId = :sourceConnectionId', { sourceConnectionId })
        .getRawMany<{ destinationConnectionId: string }>();

      return rows.map((row) => row.destinationConnectionId);
    } catch (error) {
      throw new PriceChangeEpisodePersistenceError('listOpenDestinationConnectionIds', error);
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
      row.sourceOldAmount === null ? null : Number(row.sourceOldAmount),
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
      new Date(row.updatedAt),
      row.claimedAt === null ? null : new Date(row.claimedAt)
    );
  }
}
