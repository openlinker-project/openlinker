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
 * Raw SQL for the two statements that cannot be expressed otherwise — the
 * cross-column shortfall predicate (`"olReservedQuantity" > "availableQuantity"`)
 * and the `ON CONFLICT DO NOTHING` against a PARTIAL unique index, whose
 * conflict target must repeat the index predicate (the `product_content_field`
 * precedent). Every value is a bound parameter; nothing is interpolated.
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
  olReservedQuantity: number | string;
}

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
    const rows = await this.raw<PositionRow>(
      `SELECT "id"                  AS "inventoryItemId",
              "productId",
              "productVariantId",
              "availableQuantity",
              "olReservedQuantity"
         FROM "inventory_items"
        WHERE "olReservedQuantity" > 0
          AND "olReservedQuantity" > "availableQuantity"
          AND "isStale" = false
        ORDER BY "id" ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return rows.map((row) => ({
      inventoryItemId: row.inventoryItemId,
      productId: row.productId,
      productVariantId: row.productVariantId,
      availableQuantity: Number(row.availableQuantity),
      olReservedQuantity: Number(row.olReservedQuantity),
    }));
  }

  async listShortPositionIds(
    inventoryItemIds: readonly string[]
  ): Promise<ReadonlySet<string>> {
    if (inventoryItemIds.length === 0) {
      return new Set<string>();
    }

    const rows = await this.raw<{ id: string }>(
      `SELECT "id"
         FROM "inventory_items"
        WHERE "id" = ANY($1)
          AND "olReservedQuantity" > "availableQuantity"
          AND "isStale" = false`,
      [[...inventoryItemIds]]
    );

    return new Set(rows.map((row) => row.id));
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
    const rows = await this.reservations.find({
      where: { inventoryItemId: In([...inventoryItemIds]), status: 'held' },
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
           DO NOTHING
         RETURNING *`,
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

      // No row means an episode is already open for this key. That is the
      // whole point of the partial index, and it is a success, not an error.
      return rows.length === 0 ? null : this.toDomain(rows[0]);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        throw new ReservationLedgerConstraintError(
          `Failed to open a shortfall episode for order ${input.orderRecordId} ` +
            `on position ${input.inventoryItemId}`,
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
          `Failed to close shortfall episode ${id}`,
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
