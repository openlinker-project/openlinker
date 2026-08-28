/**
 * Reservation Shortfall Repository (#2349)
 *
 * Persistence for shortfall episodes, and the two reads the reconciler above it
 * needs.
 *
 * **Nothing here writes to `inventory_items` or to `reservations`.** Both are
 * read-only to this class, deliberately: the shortfall is a fact to be named,
 * and repairing the counter would erase the evidence and restore exactly the
 * silence design § 4.2 declined the `CHECK` in order to prevent.
 *
 * Raw SQL for the statements that cannot be expressed otherwise — the shortfall
 * predicate, which compares a column against a correlated sub-select, and the
 * `ON CONFLICT DO UPDATE` against a PARTIAL unique index, whose conflict target
 * must repeat the index predicate (the `product_content_field` precedent).
 * Every value is a bound parameter; nothing is interpolated.
 *
 * **The shortfall predicate is `atpEffect`-SCOPED, not counter-based** (#2628
 * review). `inventory_items.olReservedQuantity` sums holds of both stamps, and a
 * `diagnostic` hold promises nothing — so an episode opened from the counter
 * names a real order for a risk that does not exist. On the DEFAULT
 * `omp_fulfilled` topology, where every hold is `diagnostic` and no shipped
 * closer runs, the counter grows for the life of the install and the
 * counter-based predicate opened a permanent, never-clearing episode on a
 * healthy catalogue. See `publishedReservedSum`.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 * @implements {ReservationShortfallRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError, Repository } from 'typeorm';
import { ReservationShortfallEpisodeOrmEntity } from '../entities/reservation-shortfall-episode.orm-entity';
import { ReservationOrmEntity } from '../entities/reservation.orm-entity';
import { ReservationShortfallEpisode } from '../../../domain/entities/reservation-shortfall-episode.entity';
import { Reservation } from '../../../domain/entities/reservation.entity';
import type { ReservationShortfallRepositoryPort } from '../../../domain/ports/reservation-shortfall-repository.port';
import { ReservationLedgerConstraintError } from '../../../domain/exceptions/reservation-ledger-constraint.error';
import { publishedReservedSum } from '../sql/published-reserved-sum';
import type { ReservationAtpEffect } from '../../../domain/ports/reservation-ledger-reader.port';
import type { ReservationStatus } from '../../../domain/types/reservation.types';
import type {
  OpenShortfallEpisodeInput,
  ReservationShortfallCloseReason,
  ShortfallPositionRow,
} from '../../../domain/types/reservation-shortfall.types';

/** A shortfall position as the driver returns it from raw SQL. */
interface PositionRow {
  inventoryItemId: string;
  productId: string;
  productVariantId: string | null;
  availableQuantity: number | string;
  publishedReservedQuantity: number | string;
}

/**
 * The `published`-scoped claimed sum, correlated to the `inventory_items` row
 * aliased `i`. One definition, shared by both position reads and by the
 * admission guard, so the detection predicate and the guard can never disagree
 * about what "promised" means.
 */
const PUBLISHED_SUM = publishedReservedSum({ positionAlias: 'i' });

/**
 * The one live status, as a typed constant rather than an inline literal —
 * matching the `ReservationLedgerReader` precedent, so a rename of the union
 * member is a compile break here too.
 */
const HELD: ReservationStatus = 'held';

/** The one stamp that reduces what OpenLinker publishes (ADR-061 decision 1). */
const PUBLISHED: ReservationAtpEffect = 'published';

@Injectable()
export class ReservationShortfallRepository implements ReservationShortfallRepositoryPort {
  constructor(
    @InjectRepository(ReservationShortfallEpisodeOrmEntity)
    private readonly episodes: Repository<ReservationShortfallEpisodeOrmEntity>,
    @InjectRepository(ReservationOrmEntity)
    private readonly reservations: Repository<ReservationOrmEntity>
  ) {}

  async listShortfallPositions(
    limit: number,
    offset: number
  ): Promise<readonly ShortfallPositionRow[]> {
    // `isStale` rows are excluded: a position the master no longer reports is
    // already handled by the #1689 stale-variant pause, and reporting it as a
    // shortfall would name an order for a product that is gone rather than for
    // one that is genuinely oversold.
    //
    // `olReservedQuantity > 0` stays as the leading arm purely to keep
    // `IDX_inventory_items_ol_reserved` serving the scan. It is a sound
    // pre-filter, never the test: the counter sums BOTH stamps, so a non-zero
    // counter is implied by a non-zero published sum and can never exclude a
    // genuine shortfall — while the shortfall itself is decided by
    // `PUBLISHED_SUM` alone.
    const rows = await this.raw<PositionRow>(
      `SELECT "i"."id"              AS "inventoryItemId",
              "i"."productId"       AS "productId",
              "i"."productVariantId" AS "productVariantId",
              "i"."availableQuantity" AS "availableQuantity",
              ${PUBLISHED_SUM}      AS "publishedReservedQuantity"
         FROM "inventory_items" AS "i"
        WHERE "i"."olReservedQuantity" > 0
          AND "i"."isStale" = false
          AND ${PUBLISHED_SUM} > "i"."availableQuantity"
        ORDER BY "i"."id" ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return rows.map((row) => ({
      inventoryItemId: row.inventoryItemId,
      productId: row.productId,
      productVariantId: row.productVariantId,
      availableQuantity: Number(row.availableQuantity),
      publishedReservedQuantity: Number(row.publishedReservedQuantity),
    }));
  }

  async listShortfallPositionsByIds(
    inventoryItemIds: readonly string[]
  ): Promise<readonly ShortfallPositionRow[]> {
    if (inventoryItemIds.length === 0) {
      return [];
    }

    const rows = await this.raw<PositionRow>(
      `SELECT "i"."id"              AS "inventoryItemId",
              "i"."productId"       AS "productId",
              "i"."productVariantId" AS "productVariantId",
              "i"."availableQuantity" AS "availableQuantity",
              ${PUBLISHED_SUM}      AS "publishedReservedQuantity"
         FROM "inventory_items" AS "i"
        WHERE "i"."id" = ANY($1)
          AND "i"."isStale" = false
          AND ${PUBLISHED_SUM} > "i"."availableQuantity"`,
      [[...inventoryItemIds]]
    );

    return rows.map((row) => ({
      inventoryItemId: row.inventoryItemId,
      productId: row.productId,
      productVariantId: row.productVariantId,
      availableQuantity: Number(row.availableQuantity),
      publishedReservedQuantity: Number(row.publishedReservedQuantity),
    }));
  }

  async listStalePositionIds(
    inventoryItemIds: readonly string[]
  ): Promise<readonly string[]> {
    if (inventoryItemIds.length === 0) {
      return [];
    }

    const rows = await this.raw<{ id: string }>(
      `SELECT "id" FROM "inventory_items"
        WHERE "id" = ANY($1) AND "isStale" = true`,
      [[...inventoryItemIds]]
    );
    return rows.map((row) => row.id);
  }

  async listHeldForPositions(
    inventoryItemIds: readonly string[]
  ): Promise<readonly Reservation[]> {
    if (inventoryItemIds.length === 0) {
      return [];
    }

    // Youngest first — the attribution policy the service applies. Ordered here
    // so the service never re-sorts and the two cannot disagree; `id` breaks a
    // `createdAt` tie so the result is deterministic across runs.
    //
    // Scoped to `published` (#2628 review), matching `PUBLISHED_SUM` exactly.
    // Attribution divides a shortfall that only published holds created, so a
    // `diagnostic` hold must not absorb a share of it — it would both name an
    // order that promised nothing and hide the published order that did.
    const rows = await this.reservations.find({
      where: {
        inventoryItemId: In([...inventoryItemIds]),
        status: HELD,
        atpEffect: PUBLISHED,
      },
      order: { createdAt: 'DESC', id: 'ASC' },
    });

    return rows.map((row) => this.toReservation(row));
  }

  async openEpisode(
    input: OpenShortfallEpisodeInput
  ): Promise<ReservationShortfallEpisode | null> {
    try {
      // The conflict target REPEATS the partial index's predicate — Postgres
      // will not infer a partial index otherwise, and without it this would
      // insert a duplicate open episode on every single tick.
      const rows = await this.raw<ReservationShortfallEpisodeOrmEntity>(
        `INSERT INTO "reservation_shortfall_episodes"
           ("orderRecordId", "inventoryItemId", "productVariantId", "sku",
            "shortQuantity", "positionShortfall", "openedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("orderRecordId", "inventoryItemId")
           WHERE "closedAt" IS NULL
           DO UPDATE SET
             "shortQuantity" = EXCLUDED."shortQuantity",
             "positionShortfall" = EXCLUDED."positionShortfall",
             "sku" = EXCLUDED."sku",
             "productVariantId" = EXCLUDED."productVariantId",
             -- Explicit, because raw SQL bypasses \`@UpdateDateColumn\` entirely
             -- (#2628 review): without it a refreshed row carries the timestamp
             -- of the run that OPENED it, so \`updatedAt\` reports the episode as
             -- untouched for the whole life of a condition whose numbers are in
             -- fact being rewritten on every tick.
             "updatedAt" = now()
         RETURNING *, (xmax = 0) AS "wasInserted"`,
        [
          input.orderRecordId,
          input.inventoryItemId,
          input.productVariantId,
          input.sku,
          input.shortQuantity,
          input.positionShortfall,
          input.openedAt,
        ]
      );

      // `xmax = 0` is true only for a freshly INSERTed row: Postgres stamps the
      // updating transaction id on a row it replaced, so this is the standard
      // way to tell an insert from an upsert's update arm.
      //
      // A conflict now REFRESHES the quantities instead of doing nothing
      // (#2628 review). The episode ID is deliberately untouched by that
      // update, so an edge-triggered automation keyed on it still sees one
      // occurrence for one standing condition; only the numbers move, and they
      // must, or a partial recovery leaves the row asserting a figure nothing
      // recomputes.
      if (rows.length === 0) return null;
      const row = rows[0] as ReservationShortfallEpisodeOrmEntity & { wasInserted?: boolean };
      return row.wasInserted === true ? this.toDomain(row) : null;
    } catch (error) {
      if (error instanceof QueryFailedError) {
        // A constraint NAME, not a sentence: every other call site on this
        // error passes one, and the message is composed from it.
        throw new ReservationLedgerConstraintError(
          'reservation_shortfall_episodes.open',
          error
        );
      }
      throw error;
    }
  }

  async listOpenEpisodes(
    limit: number,
    offset: number
  ): Promise<readonly ReservationShortfallEpisode[]> {
    const rows = await this.episodes.find({
      where: { closedAt: IsNull() },
      order: { id: 'ASC' },
      take: limit,
      skip: offset,
    });
    return rows.map((row) => this.toDomain(row));
  }

  async closeEpisode(
    id: string,
    reason: ReservationShortfallCloseReason,
    closedAt: Date
  ): Promise<boolean> {
    try {
      // Guarded, so a concurrent close cannot overwrite the first closer's
      // reason and timestamp. `false` means somebody else closed it — which is
      // a success for the caller, not a failure.
      const result = await this.episodes.update(
        { id, closedAt: IsNull() },
        { closedAt, closeReason: reason }
      );
      return (result.affected ?? 0) > 0;
    } catch (error) {
      if (error instanceof QueryFailedError) {
        throw new ReservationLedgerConstraintError(
          'reservation_shortfall_episodes.close',
          error
        );
      }
      throw error;
    }
  }

  async listOpenByOrderRecordId(
    orderRecordId: string
  ): Promise<readonly ReservationShortfallEpisode[]> {
    const rows = await this.episodes.find({
      where: { orderRecordId, closedAt: IsNull() },
      order: { openedAt: 'ASC' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  /**
   * Raw query, normalised to a row list.
   *
   * Copied deliberately from `ReservationRepository.raw` rather than reinvented:
   * node-postgres surfaces a data-modifying statement with `RETURNING` as
   * `[rows, affectedCount]` and a plain `SELECT` as the row array directly, so
   * `openEpisode`'s `INSERT ... RETURNING *` and the two SELECTs here do NOT
   * come back in the same shape. Reading the outer array AS the row list is the
   * exact mistake that sibling documents having made — and here it would make
   * `rows.length === 0` read "already open" for a row that WAS just inserted,
   * silently miscounting every episode this pass opens.
   */
  private async raw<T>(sql: string, params: readonly unknown[]): Promise<T[]> {
    const reply = (await this.episodes.manager.query(sql, [...params])) as unknown;
    const outer = Array.isArray(reply) ? reply : [];
    return (Array.isArray(outer[0]) ? outer[0] : outer) as T[];
  }

  async listOpenByOrderRecordIds(
    orderRecordIds: readonly string[]
  ): Promise<readonly ReservationShortfallEpisode[]> {
    if (orderRecordIds.length === 0) {
      return [];
    }

    const rows = await this.episodes.find({
      where: { orderRecordId: In([...orderRecordIds]), closedAt: IsNull() },
      order: { orderRecordId: 'ASC', openedAt: 'ASC' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: ReservationShortfallEpisodeOrmEntity): ReservationShortfallEpisode {
    return new ReservationShortfallEpisode(
      row.id,
      row.orderRecordId,
      row.inventoryItemId,
      row.productVariantId,
      row.sku,
      Number(row.shortQuantity),
      Number(row.positionShortfall),
      new Date(row.openedAt),
      row.closedAt === null ? null : new Date(row.closedAt),
      row.closeReason,
      new Date(row.createdAt),
      new Date(row.updatedAt)
    );
  }

  private toReservation(row: ReservationOrmEntity): Reservation {
    return new Reservation(
      row.id,
      row.orderRecordId,
      row.orderLineId,
      row.inventoryItemId,
      Number(row.quantity),
      row.status,
      new Date(row.expiresAt),
      row.atpEffect,
      new Date(row.createdAt),
      new Date(row.updatedAt),
      row.closedAt === null ? null : new Date(row.closedAt)
    );
  }
}
