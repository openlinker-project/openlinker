/**
 * Order Hold Projection Repository (#2340, DESIGN §6.3)
 *
 * The single write statement behind `order_records.activeHoldReason`, plus the
 * divergence read its reconcile pass pages over. See
 * {@link OrderHoldProjectionRepositoryPort} for the contract and for why no hold
 * gate may read this column.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 * @implements {OrderHoldProjectionRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isHoldReason, type HoldReason } from '@openlinker/core/order-lifecycle';
import type {
  OrderHoldProjectionRepositoryPort,
  SetActiveHoldReasonOptions,
} from '../../../domain/ports/order-hold-projection-repository.port';
import type { HoldProjectionDivergence } from '../../../domain/types/order-hold-projection.types';
import { OrderRecordOrmEntity } from '../entities/order-record.orm-entity';

interface DivergenceRow {
  internalOrderId: string;
  expectedReason: string | null;
  projectedReason: string | null;
}

@Injectable()
export class OrderHoldProjectionRepository implements OrderHoldProjectionRepositoryPort {
  constructor(
    @InjectRepository(OrderRecordOrmEntity)
    private readonly repository: Repository<OrderRecordOrmEntity>
  ) {}

  async setActiveHoldReason(
    internalOrderId: string,
    reason: HoldReason | null,
    options?: SetActiveHoldReasonOptions
  ): Promise<boolean> {
    // The no-op guard lives in the WHERE rather than at the caller (#2100): a
    // caller-side comparison holds a value read before its own round trip, so a
    // concurrent writer could change the row in between and make a genuinely new
    // answer look unchanged. `IS DISTINCT FROM` is NULL-safe, so it is exact for
    // the clear case too.
    //
    // The optional third arm is the reconcile pass's compare-and-set. It is
    // appended rather than replacing the guard above: both must hold, since a
    // repair to a value the row already carries is still a no-op.
    const casArm =
      options === undefined ? '' : ` AND "activeHoldReason" IS NOT DISTINCT FROM $3`;
    const parameters: unknown[] =
      options === undefined
        ? [reason, internalOrderId]
        : [reason, internalOrderId, options.ifCurrentlyIs];

    const result = (await this.repository.query(
      `UPDATE "order_records"
          SET "activeHoldReason" = $1,
              "updatedAt" = now()
        WHERE "internalOrderId" = $2
          AND "activeHoldReason" IS DISTINCT FROM $1${casArm}`,
      parameters
    )) as unknown;

    return readAffectedRows(result) > 0;
  }

  async findDivergentProjections(limit: number): Promise<HoldProjectionDivergence[]> {
    // A FULL OUTER JOIN would also express this, but the two candidate arms are
    // what keep it index-served, so they are spelled out: the open-hold side is
    // driven by `UQ_order_holds_open_order`'s predicate and the missed-clear side
    // by the partial `IDX_order_records_active_hold`. Both tables are `orders`,
    // so ADR-036's cross-context join rules do not apply.
    //
    // The `releasedAt IS NULL` predicate MUST match that unique index exactly —
    // it is what makes "is this order held?" and "what is holding it?" one
    // question (see `OrderHoldRepositoryPort.findOpenByOrder`).
    const rows = (await this.repository.query(
      `SELECT rec."internalOrderId"      AS "internalOrderId",
              h."reason"                 AS "expectedReason",
              rec."activeHoldReason"     AS "projectedReason"
         FROM "order_records" rec
         JOIN "order_holds" h
           ON h."internalOrderId" = rec."internalOrderId"
          AND h."releasedAt" IS NULL
        WHERE rec."activeHoldReason" IS DISTINCT FROM h."reason"

        -- UNION ALL, not UNION: the two arms are mutually exclusive by
        -- construction (one requires an open hold, the other requires none),
        -- so the dedupe pass would sort for nothing.
        UNION ALL

       SELECT rec."internalOrderId"      AS "internalOrderId",
              NULL                       AS "expectedReason",
              rec."activeHoldReason"     AS "projectedReason"
         FROM "order_records" rec
        WHERE rec."activeHoldReason" IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM "order_holds" h
                 WHERE h."internalOrderId" = rec."internalOrderId"
                   AND h."releasedAt" IS NULL
              )

        ORDER BY "internalOrderId"
        LIMIT $1`,
      [limit]
    )) as DivergenceRow[];

    return rows.map((row) => ({
      internalOrderId: row.internalOrderId,
      // Coerced, never trusted: an unrecognised persisted reason must not be
      // written back as though it were vocabulary. `null` here means "clear it",
      // which is the correct repair for a value no build recognises.
      //
      // One consequence, named so a stuck counter is diagnosable rather than
      // mysterious: an OPEN hold whose own `reason` fails the guard never
      // converges. The repair writes `null`, the next tick re-selects the same
      // row, and it reports as a permanently non-zero `examined` with
      // `repaired: 0`. It is unreachable while `OrderHoldService` is the only
      // writer (the union is closed at both the service and the DTO) and it is
      // safe either way, since the hold GATES read `order_holds` and not this
      // column.
      expectedReason: isHoldReason(row.expectedReason) ? row.expectedReason : null,
      projectedReason: row.projectedReason,
    }));
  }
}

/**
 * `Repository.query` on an UPDATE returns node-postgres' `[rows, affected]`
 * tuple. Read defensively — a driver returning something else must degrade to
 * "nothing changed" rather than throwing inside a best-effort write.
 */
function readAffectedRows(result: unknown): number {
  if (Array.isArray(result) && typeof result[1] === 'number') {
    return result[1];
  }
  return 0;
}
