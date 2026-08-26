/**
 * Reservation Repository (#2343, ANALYSIS-1032 § 6I, REVIEW § 3 H9)
 *
 * The write half of OpenLinker's advisory reservation ledger. Every state
 * transition here is a **guarded conditional UPDATE** — `UPDATE … WHERE
 * <precondition> RETURNING`, with `affected > 0` as the answer — and every way
 * one can match nothing raises a **named domain error**. An unlocked
 * read-then-act is the defect shape § 6I exists to replace, and the failure mode
 * of getting it wrong is an oversell, so nothing here reads a value and then
 * decides on it in application code.
 *
 * Two structural notes:
 *
 * - **`claimHeld` owns the ledger row AND the counter, in one transaction.**
 *   Keeping `inventory_items.olReservedQuantity` consistent with the ledger is
 *   this repository's own invariant, not caller policy — so the caller supplies
 *   the DESIRED quantity and the delta is computed here. Get-or-create and
 *   delta-adjust fall out of one operation, and no caller is in a position to
 *   forget the transaction.
 * - **Raw SQL, not the query builder, for the two guarded statements.** The
 *   guards read a column against an expression over two other columns
 *   (`"availableQuantity" - "olReservedQuantity" >= $2`) and need `GREATEST`;
 *   the builder cannot express either without a raw fragment anyway. Every value
 *   is a bound parameter — nothing is interpolated.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 * @implements {ReservationRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager} from 'typeorm';
import { DataSource, LessThan, QueryFailedError, Repository } from 'typeorm';
import { ReservationOrmEntity } from '../entities/reservation.orm-entity';
import { Reservation } from '../../../domain/entities/reservation.entity';
import type { ReservationRepositoryPort } from '../../../domain/ports/reservation-repository.port';
import { InsufficientAvailabilityError } from '../../../domain/exceptions/insufficient-availability.error';
import { ReservationLedgerConstraintError } from '../../../domain/exceptions/reservation-ledger-constraint.error';
import { ReservationNotHeldError } from '../../../domain/exceptions/reservation-not-held.error';
import { ReservationPositionUnavailableError } from '../../../domain/exceptions/reservation-position-unavailable.error';
import type {
  ExtendReservationExpiryInput,
  ReleaseReservationInput,
  ReservationClaimInput,
  ReservationClaimOutcome,
  ReservationKey,
} from '../../../domain/types/reservation.types';

/** Shape of a `reservations` row as the driver returns it from raw SQL. */
interface ReservationRow {
  id: string;
  orderRecordId: string;
  orderLineId: string;
  inventoryItemId: string;
  quantity: number | string;
  status: string;
  expiresAt: Date | string;
  atpEffect: string;
  closedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

@Injectable()
export class ReservationRepository implements ReservationRepositoryPort {
  constructor(
    @InjectRepository(ReservationOrmEntity)
    private readonly repository: Repository<ReservationOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async claimHeld(
    claims: readonly ReservationClaimInput[],
  ): Promise<readonly ReservationClaimOutcome[]> {
    if (claims.length === 0) {
      // No transaction for no work. A caller passing an empty set is legitimate
      // (an order whose every line resolved to nothing reservable), not an edge
      // case worth a round trip.
      return [];
    }

    for (const claim of claims) {
      if (!Number.isInteger(claim.quantity) || claim.quantity <= 0) {
        // Guarded before any statement, and before the transaction: the
        // `CHK_reservations_quantity_positive` constraint is the hard floor, but
        // a caller deserves a message naming the offending line rather than a
        // constraint name.
        throw new RangeError(
          `Reservation quantity must be a positive integer (order ${claim.orderRecordId}, ` +
            `line ${claim.orderLineId}): received ${String(claim.quantity)}`,
        );
      }
    }

    // MANDATORY, not stylistic (§ 6I): two multi-line orders touching the same
    // positions in opposite input order deadlock without a common lock order.
    // Sorted on a copy — mutating a caller's array would be a side effect on an
    // input typed `readonly`.
    const ordered = [...claims].sort((a, b) =>
      a.inventoryItemId < b.inventoryItemId ? -1 : a.inventoryItemId > b.inventoryItemId ? 1 : 0,
    );

    return this.translate(() =>
      this.dataSource.transaction(async (manager) => {
        const outcomes: ReservationClaimOutcome[] = [];
        for (const claim of ordered) {
          outcomes.push(await this.claimOne(manager, claim));
        }
        return outcomes;
      }),
    );
  }

  async releaseHeld(input: ReleaseReservationInput): Promise<Reservation> {
    return this.translate(() =>
      this.dataSource.transaction(async (manager) => {
        // The LEDGER row is the guard, not the counter. § 6I places the
        // predicate on `inventory_items ... WHERE olReservedQuantity >= $q`;
        // that is wrong once a reconciler exists, because the ledger is
        // authoritative and a corrected counter would make the counter-side
        // predicate report "not held" about a row that plainly is.
        const rows = await this.raw<ReservationRow>(
          manager,
          `UPDATE "reservations"
              SET "status" = $4, "closedAt" = now(), "updatedAt" = now()
            WHERE "orderRecordId" = $1
              AND "orderLineId" = $2
              AND "inventoryItemId" = $3
              AND "status" = 'held'
        RETURNING *`,
          [input.orderRecordId, input.orderLineId, input.inventoryItemId, input.terminalStatus],
        );

        const released = rows[0];
        if (!released) {
          // Raised rather than treated as an idempotent no-op: a double release
          // that quietly succeeded is indistinguishable from a real one, and the
          // second decrement is exactly how the counter drifts below the ledger.
          throw new ReservationNotHeldError(
            input.orderRecordId,
            input.orderLineId,
            input.inventoryItemId,
          );
        }

        const quantity = Number(released.quantity);

        // `GREATEST(0, …)` because a reconciler may already have corrected the
        // counter (§ 6I); the CHECK stays the hard floor beneath it. No guard is
        // needed on this statement — the ledger flip above already established
        // that exactly one release is happening.
        await this.raw(
          manager,
          `UPDATE "inventory_items"
              SET "olReservedQuantity" = GREATEST(0, "olReservedQuantity" - $2)
            WHERE "id" = $1`,
          [input.inventoryItemId, quantity],
        );

        return this.toDomain(released);
      }),
    );
  }

  async extendHeldExpiry(input: ExtendReservationExpiryInput): Promise<Reservation> {
    return this.translate(() =>
      this.dataSource.transaction(async (manager) => {
        // Guarded on `status = 'held'` exactly as `releaseHeld` is: a row that
        // went terminal between the sweep's page read and this write must not be
        // resurrected into a live hold.
        //
        // `atpEffect` is deliberately absent from the SET list — it is immutable
        // (ADR-061 decision 1), and rewriting it would move a published quantity
        // with no audit trail. No counter moves either: an extension changes WHEN
        // the units stop being claimed, never HOW MANY.
        const rows = await this.raw<ReservationRow>(
          manager,
          `UPDATE "reservations"
              SET "expiresAt" = $4, "updatedAt" = now()
            WHERE "orderRecordId" = $1
              AND "orderLineId" = $2
              AND "inventoryItemId" = $3
              AND "status" = 'held'
        RETURNING *`,
          [input.orderRecordId, input.orderLineId, input.inventoryItemId, input.expiresAt],
        );

        const extended = rows[0];
        if (!extended) {
          throw new ReservationNotHeldError(
            input.orderRecordId,
            input.orderLineId,
            input.inventoryItemId,
          );
        }

        return this.toDomain(extended);
      }),
    );
  }

  async listHeldExpiredBefore(before: Date, limit: number): Promise<readonly Reservation[]> {
    const entities = await this.translate(() =>
      this.repository.find({
        where: { status: 'held', expiresAt: LessThan(before) },
        // Longest-overdue first, so a persistently failing tail cannot starve
        // the holds that have been expired the longest.
        order: { expiresAt: 'ASC' },
        take: limit,
      }),
    );
    return entities.map((entity) => this.toDomainFromEntity(entity));
  }

  async findHeld(key: ReservationKey): Promise<Reservation | null> {
    const entity = await this.translate(() =>
      this.repository.findOne({
        where: {
          orderRecordId: key.orderRecordId,
          orderLineId: key.orderLineId,
          inventoryItemId: key.inventoryItemId,
          status: 'held',
        },
      }),
    );
    return entity ? this.toDomainFromEntity(entity) : null;
  }

  async listHeldByOrderRecordId(orderRecordId: string): Promise<readonly Reservation[]> {
    const entities = await this.translate(() =>
      this.repository.find({
        where: { orderRecordId, status: 'held' },
        order: { inventoryItemId: 'ASC' },
      }),
    );
    return entities.map((entity) => this.toDomainFromEntity(entity));
  }

  async listByOrderRecordId(orderRecordId: string): Promise<readonly Reservation[]> {
    const entities = await this.translate(() =>
      this.repository.find({
        where: { orderRecordId },
        order: { inventoryItemId: 'ASC' },
      }),
    );
    return entities.map((entity) => this.toDomainFromEntity(entity));
  }

  /**
   * One line of a claim, inside the caller's transaction.
   *
   * Insert-then-recover (the `IdentifierMappingService` idiom): a conflict on
   * the partial unique index is a SUCCESS — an existing held row for the same
   * key is a granted reservation, which is what makes an ingestion crash after
   * `claimHeld` resumable rather than wedging the order behind a false
   * "insufficient stock" (ADR-061 amendment 2).
   */
  private async claimOne(
    manager: EntityManager,
    claim: ReservationClaimInput,
  ): Promise<ReservationClaimOutcome> {
    // The INSERT reaches the FK before the guarded add can classify anything, so
    // a position that does not exist surfaces here as a constraint violation and
    // NOT through `applyGuardedAdd`'s probe. Translated at this one site so the
    // caller still receives the named, operator-actionable
    // `ReservationPositionUnavailableError('missing')` the port documents —
    // rather than `ReservationLedgerConstraintError`, which means "a guard that
    // should have made this unreachable did not hold", i.e. a defect signal.
    const inserted = await this.insertHeld(manager, claim);

    let row = inserted[0];
    let previousQuantity = 0;

    if (!row) {
      // Conflict: recover the winner. `atpEffect` and `expiresAt` are NOT
      // rewritten — the stamp is immutable per reservation (ADR-061 decision 1),
      // and extending an expiry is #2349's state-dependent sweep, never a side
      // effect of re-reserving.
      const existing = await this.raw<ReservationRow>(
        manager,
        `SELECT * FROM "reservations"
          WHERE "orderRecordId" = $1 AND "orderLineId" = $2
            AND "inventoryItemId" = $3 AND "status" = 'held'
          FOR UPDATE`,
        [claim.orderRecordId, claim.orderLineId, claim.inventoryItemId],
      );
      const found = existing[0];
      if (!found) {
        // The conflicting row was terminalised between the INSERT and this read.
        // Reported as a constraint anomaly rather than retried in place: a retry
        // loop here would be an unbounded read-then-act, and the caller's job
        // retry re-enters the whole transaction cleanly.
        throw new ReservationLedgerConstraintError('UQ_reservations_active_line');
      }
      row = found;
      previousQuantity = Number(found.quantity);
    }

    const delta = claim.quantity - previousQuantity;

    if (delta === 0) {
      // An identical repeat touches the counter not at all. This is what makes
      // #2344's crash-resume safe: replaying a reserve cannot double-increment.
      return { reservation: this.toDomain(row), previousQuantity, deltaApplied: 0, remainingAtp: null };
    }

    if (delta > 0) {
      const remainingAtp = await this.applyGuardedAdd(manager, claim.inventoryItemId, delta);
      const updated = await this.setQuantity(manager, row.id, claim.quantity);
      return {
        reservation: this.toDomain(updated),
        previousQuantity,
        deltaApplied: delta,
        remainingAtp,
      };
    }

    // A narrowing — the source amended the line down. Released units can never
    // fail on availability, so this takes the clamped decrement, not the guard.
    await this.raw(
      manager,
      `UPDATE "inventory_items"
          SET "olReservedQuantity" = GREATEST(0, "olReservedQuantity" - $2)
        WHERE "id" = $1`,
      [claim.inventoryItemId, -delta],
    );
    const updated = await this.setQuantity(manager, row.id, claim.quantity);
    return {
      reservation: this.toDomain(updated),
      previousQuantity,
      deltaApplied: delta,
      remainingAtp: null,
    };
  }

  /**
   * The ledger INSERT, with the one constraint that is NOT a defect signal
   * translated at the point it can still name the position.
   */
  private async insertHeld(
    manager: EntityManager,
    claim: ReservationClaimInput,
  ): Promise<ReservationRow[]> {
    try {
      return await this.raw<ReservationRow>(
        manager,
        `INSERT INTO "reservations"
         ("orderRecordId", "orderLineId", "inventoryItemId", "quantity",
          "status", "expiresAt", "atpEffect")
       VALUES ($1, $2, $3, $4, 'held', $5, $6)
       ON CONFLICT DO NOTHING
    RETURNING *`,
        [
          claim.orderRecordId,
          claim.orderLineId,
          claim.inventoryItemId,
          claim.quantity,
          claim.expiresAt,
          claim.atpEffect,
        ],
      );
    } catch (error) {
      // Matched on the SQLSTATE class (`23503`, foreign_key_violation), not on
      // the constraint name: the integration harness builds its schema by
      // `synchronize`, which mints a hashed FK name, so a name match would hold
      // under the migration-built schema and silently miss under the harness —
      // i.e. exactly backwards from where a test could catch it.
      if (error instanceof QueryFailedError && this.sqlStateOf(error) === '23503') {
        throw new ReservationPositionUnavailableError(claim.inventoryItemId, 'missing');
      }
      throw error;
    }
  }

  /**
   * § 6I's guarded reserve, verbatim.
   *
   * Zero rows means the position is missing, stale, or short of units — three
   * different operator situations, discriminated by a follow-up read that runs
   * ONLY on this failure path. That read is deliberately unlocked: a race can
   * mislabel an already-failing claim, but can never turn a failure into a
   * success (the guard already decided that), and `FOR SHARE` here would put a
   * lock on the failure path of the hottest write in the system.
   */
  private async applyGuardedAdd(
    manager: EntityManager,
    inventoryItemId: string,
    delta: number,
  ): Promise<number> {
    const rows = await this.raw<{ remainingAtp: number | string }>(
      manager,
      `UPDATE "inventory_items"
          SET "olReservedQuantity" = "olReservedQuantity" + $2
        WHERE "id" = $1
          AND "isStale" = false
          AND "availableQuantity" - "olReservedQuantity" >= $2
    RETURNING "availableQuantity" - "olReservedQuantity" AS "remainingAtp"`,
      [inventoryItemId, delta],
    );

    const claimed = rows[0];
    if (claimed) {
      return Number(claimed.remainingAtp);
    }

    const probe = await this.raw<{ isStale: boolean; atp: number | string }>(
      manager,
      `SELECT "isStale", "availableQuantity" - "olReservedQuantity" AS "atp"
         FROM "inventory_items" WHERE "id" = $1`,
      [inventoryItemId],
    );
    const position = probe[0];
    if (!position) {
      throw new ReservationPositionUnavailableError(inventoryItemId, 'missing');
    }
    if (position.isStale) {
      throw new ReservationPositionUnavailableError(inventoryItemId, 'stale');
    }
    throw new InsufficientAvailabilityError(inventoryItemId, delta, Number(position.atp));
  }

  private async setQuantity(
    manager: EntityManager,
    reservationId: string,
    quantity: number,
  ): Promise<ReservationRow> {
    const rows = await this.raw<ReservationRow>(
      manager,
      `UPDATE "reservations" SET "quantity" = $2, "updatedAt" = now()
        WHERE "id" = $1 AND "status" = 'held'
    RETURNING *`,
      [reservationId, quantity],
    );
    const updated = rows[0];
    if (!updated) {
      // Unreachable: the row was locked `FOR UPDATE` (or freshly inserted) in
      // this same transaction. Fail loudly rather than return a stale entity.
      throw new ReservationLedgerConstraintError('reservations.quantity');
    }
    return updated;
  }

  /**
   * Raw query with the reply shape normalised.
   *
   * node-postgres surfaces a data-modifying statement with `RETURNING` as
   * `[rows, affectedCount]` through TypeORM's raw query, and a plain `SELECT` as
   * the row array directly. Normalised rather than trusted — the driver's typing
   * for a raw query is `any`, and reading the outer array AS the row list is the
   * exact mistake `markVariantsStaleExcept` documents having made.
   */
  private async raw<T>(
    manager: EntityManager,
    sql: string,
    params: readonly unknown[],
  ): Promise<T[]> {
    const reply = (await manager.query(sql, [...params])) as unknown;
    const outer = Array.isArray(reply) ? reply : [];
    return (Array.isArray(outer[0]) ? outer[0] : outer) as T[];
  }

  /**
   * The single translation boundary: no `QueryFailedError` leaves this class
   * (`docs/engineering-standards.md § Error Handling`). Already-named domain
   * errors pass through untouched.
   */
  private async translate<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof QueryFailedError) {
        throw new ReservationLedgerConstraintError(
          this.constraintNameOf(error) ?? 'unknown',
          error,
        );
      }
      throw error;
    }
  }

  private sqlStateOf(error: QueryFailedError): string | null {
    const driver = error.driverError as { code?: unknown } | undefined;
    return typeof driver?.code === 'string' ? driver.code : null;
  }

  private constraintNameOf(error: QueryFailedError): string | null {
    const driver = error.driverError as { constraint?: unknown } | undefined;
    return typeof driver?.constraint === 'string' ? driver.constraint : null;
  }

  private toDomain(row: ReservationRow): Reservation {
    return new Reservation(
      row.id,
      row.orderRecordId,
      row.orderLineId,
      row.inventoryItemId,
      Number(row.quantity),
      row.status as Reservation['status'],
      new Date(row.expiresAt),
      row.atpEffect as Reservation['atpEffect'],
      new Date(row.createdAt),
      new Date(row.updatedAt),
      row.closedAt === null ? null : new Date(row.closedAt),
    );
  }

  private toDomainFromEntity(entity: ReservationOrmEntity): Reservation {
    return new Reservation(
      entity.id,
      entity.orderRecordId,
      entity.orderLineId,
      entity.inventoryItemId,
      Number(entity.quantity),
      entity.status,
      entity.expiresAt,
      entity.atpEffect,
      entity.createdAt,
      entity.updatedAt,
      entity.closedAt,
    );
  }
}
