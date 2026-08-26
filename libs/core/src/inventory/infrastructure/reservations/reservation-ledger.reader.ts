/**
 * Reservation Ledger Reader (#2345, ADR-061 decision 1)
 *
 * The read half of OpenLinker's advisory reservation ledger, against real rows —
 * the Wave-2 replacement for the `EmptyReservationLedgerReader` stand-in #2321
 * shipped so the ATP formula could carry the term before the table existed.
 *
 * It answers exactly one question: *how many units of this variant are claimed
 * right now by holds carrying this stamp?* Four properties of that query are
 * load-bearing rather than incidental.
 *
 * **The stamp is a bound column test, never an inference.** `atpEffect` is
 * written on the row at creation by the ingestion caller holding the routing
 * outcome (#2344) and is immutable, so a `diagnostic` hold is invisible to a
 * `published` read *by construction* — it cannot affect a published quantity
 * under any configuration, which is the answer to §6I's original kill condition.
 * Nothing here derives the stamp, and nothing may.
 *
 * **Only `held` rows count.** Terminal rows are kept forever (never deleted), so
 * a query keyed on row existence would subtract every release the system has
 * ever performed.
 *
 * **`isStale = false` mirrors the numerator.** `findAvailabilityByVariantIds`
 * excludes stale positions (#1478), so a hold against a staled position must be
 * excluded too — subtracting it from a total that never included it silently
 * under-publishes the variant.
 *
 * **The sum is grouped by the POSITION's `productVariantId`**, which is what
 * makes the ledger term commensurable with the availability term: both are
 * variant-keyed sums across every live position, all locations and all sources
 * (ADR-058 decision 2 — a cross-source sum is legitimate coexisting mirrors).
 *
 * That commensurability is also why a hold against a PRODUCT-LEVEL position
 * (`productVariantId IS NULL`, which #2344 can legitimately resolve a line to)
 * is absent from this sum: the `IN (:...variantIds)` arm excludes NULL, exactly
 * as `findAvailabilityByVariantIds` does. Both terms drop the same row, so the
 * omission is symmetric and cannot oversell — but the two predicates have to
 * keep agreeing. Narrowing one without the other subtracts a hold from a total
 * that never contained its stock, or the reverse.
 *
 * @module libs/core/src/inventory/infrastructure/reservations
 * @implements {ReservationLedgerReaderPort}
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryItemOrmEntity } from '../persistence/entities/inventory-item.orm-entity';
import { ReservationOrmEntity } from '../persistence/entities/reservation.orm-entity';
import type {
  ReservationLedgerReaderPort,
  SumReservedInput,
} from '../../domain/ports/reservation-ledger-reader.port';
import type { AvailabilityScope } from '../../domain/types/availability.types';
import type { ReservationStatus } from '../../domain/types/reservation.types';
import { UnsupportedAvailabilityScopeError } from '../../domain/exceptions/unsupported-availability-scope.error';

/**
 * The one live status. Typed rather than inlined so a rename of the union member
 * is a compile break here too — the repository spells it as a literal inside raw
 * SQL, which the compiler cannot check.
 */
const HELD: ReservationStatus = 'held';

/** One `GROUP BY` row as the driver returns it — `SUM` arrives as a string. */
interface ReservedSumRow {
  productVariantId: string;
  reserved: string | number;
}

@Injectable()
export class ReservationLedgerReader implements ReservationLedgerReaderPort {
  constructor(
    @InjectRepository(ReservationOrmEntity)
    private readonly repository: Repository<ReservationOrmEntity>
  ) {}

  async sumReservedByVariantIds(input: SumReservedInput): Promise<ReadonlyMap<string, number>> {
    this.assertAnswerableScope(input.scope);

    // Guarded before any statement: `IN ()` is a Postgres syntax error, and an
    // empty ask has no answer worth a round trip.
    if (input.variantIds.length === 0) return new Map<string, number>();

    const rows = await this.repository
      .createQueryBuilder('r')
      // Same-context join (both tables belong to `inventory`), so ADR-036's
      // cross-context escape hatch does not apply and the join target is the ORM
      // ENTITY rather than a raw `'inventory_items'` string — a table rename is
      // then a compile break here instead of a runtime `relation does not exist`.
      .innerJoin(InventoryItemOrmEntity, 'inv', 'inv."id" = r."inventoryItemId"')
      .select('inv."productVariantId"', 'productVariantId')
      .addSelect('SUM(r."quantity")', 'reserved')
      .where('r."status" = :status', { status: HELD })
      .andWhere('r."atpEffect" = :atpEffect', { atpEffect: input.atpEffect })
      .andWhere('inv."productVariantId" IN (:...variantIds)', {
        variantIds: [...input.variantIds],
      })
      .andWhere('inv."isStale" = false')
      .groupBy('inv."productVariantId"')
      .getRawMany<ReservedSumRow>();

    // Entries only for variants with a hold — an absent key means zero, the same
    // convention `findAvailabilityByVariantIds` uses, so the caller zero-fills
    // once. Every `quantity` is `> 0` by CHECK constraint, so a returned group
    // can never sum to zero.
    return new Map(rows.map((row) => [row.productVariantId, Number(row.reserved)]));
  }

  /**
   * Refuse the three scopes this reader cannot partition by.
   *
   * `global` and `channel` share one answer deliberately: a hold is a claim on
   * PHYSICAL stock, so it reduces what any channel may promise, and reservations
   * carry no channel axis to filter on. Inventing one would mean a hold placed
   * by one channel's order does not reduce another channel's promise — an
   * oversell by construction.
   *
   * `location` / `order` / `work` throw here as well as in `AvailabilityService`,
   * and the repetition is the point rather than an oversight: a future caller
   * reaching the reader directly must not receive an unfiltered, whole-catalogue
   * sum dressed up as a location-scoped one.
   */
  private assertAnswerableScope(scope: AvailabilityScope): void {
    switch (scope.kind) {
      case 'channel':
      case 'global':
        return;
      case 'location':
      case 'order':
      case 'work':
        throw new UnsupportedAvailabilityScopeError(scope.kind);
    }
  }
}
