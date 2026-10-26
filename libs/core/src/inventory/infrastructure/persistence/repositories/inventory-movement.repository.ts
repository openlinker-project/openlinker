/**
 * Inventory Movement Repository (#3565)
 *
 * TypeORM implementation of {@link InventoryMovementRepositoryPort}.
 *
 * The history read is one parameterised `UNION ALL` over `inventory_movements`
 * and `reservations`. Reservations are shown as "Promised" rows and never written
 * as movements (ADR-061: they change what OpenLinker promises, not the stock). The
 * read joins `product_variants` / `products` for the SKU and product name only -
 * a read-only join, the ADR-036 cross-context read-model precedent.
 *
 * No user input is ever interpolated: filters become `$n` parameters, and the
 * search term has its LIKE wildcards escaped.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InventoryMovement } from '../../../domain/entities/inventory-movement.entity';
import type { InventoryMovementRepositoryPort } from '../../../domain/ports/inventory-movement-repository.port';
import {
  InventoryMovementOperatorReasonValues,
  InventoryMovementReasonValues,
  InventoryMovementSourceKindValues,
  InventoryMovementStatusValues,
  type AppendInventoryMovementInput,
  type InsertPendingInventoryMovementInput,
  type InventoryHistoryRow,
  type InventoryMovementFilters,
  type InventoryMovementOperatorReason,
  type InventoryMovementPagination,
  type InventoryMovementReason,
  type InventoryMovementSourceKind,
  type InventoryMovementStatus,
  type SettleInventoryMovementInput,
} from '../../../domain/types/inventory-movement.types';
import { InventoryMovementOrmEntity } from '../entities/inventory-movement.orm-entity';

const TABLE = '"inventory_movements"';

interface HistoryRawRow {
  kind: 'movement' | 'reservation';
  id: string;
  productId: string;
  productVariantId: string | null;
  sku: string | null;
  productName: string | null;
  locationId: string | null;
  sourceConnectionId: string | null;
  reason: string | null;
  status: string;
  quantityDelta: number;
  quantityBefore: number | null;
  quantityAfter: number | null;
  sourceKind: string | null;
  sourceRef: string | null;
  operatorReason: string | null;
  note: string | null;
  actorUserId: string | null;
  refusalReason: string | null;
  refusalDetail: string | null;
  occurredAt: Date;
  sourceLabel: string | null;
}

function narrow<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

@Injectable()
export class InventoryMovementRepository implements InventoryMovementRepositoryPort {
  constructor(
    @InjectRepository(InventoryMovementOrmEntity)
    private readonly repository: Repository<InventoryMovementOrmEntity>
  ) {}

  async append(input: AppendInventoryMovementInput): Promise<InventoryMovement> {
    const saved = await this.repository.save(
      this.repository.create({
        productId: input.productId,
        productVariantId: input.productVariantId,
        locationId: input.locationId,
        sourceConnectionId: input.sourceConnectionId,
        reason: input.reason,
        status: 'applied',
        quantityDelta: input.quantityDelta,
        quantityBefore: input.quantityBefore,
        quantityAfter: input.quantityAfter,
        sourceKind: input.sourceKind,
        sourceRef: input.sourceRef,
        actorUserId: input.actorUserId,
        operatorReason: null,
        note: null,
        idempotencyKey: null,
        refusalReason: null,
        refusalDetail: null,
        occurredAt: input.occurredAt,
      })
    );
    return this.toDomain(saved);
  }

  async insertPending(
    input: InsertPendingInventoryMovementInput
  ): Promise<InventoryMovement | null> {
    const rows = (await this.repository.query(
      `INSERT INTO ${TABLE}
         ("productId", "productVariantId", "locationId", "sourceConnectionId", "reason",
          "status", "quantityDelta", "sourceKind", "sourceRef", "actorUserId",
          "operatorReason", "note", "idempotencyKey", "occurredAt")
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        input.productId,
        input.productVariantId,
        input.locationId,
        input.sourceConnectionId,
        input.reason,
        input.quantityDelta,
        input.sourceKind,
        input.sourceRef,
        input.actorUserId,
        input.operatorReason,
        input.note,
        input.idempotencyKey,
        input.occurredAt,
      ]
    )) as InventoryMovementOrmEntity[];
    return rows.length > 0 ? this.toDomain(rows[0]) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<InventoryMovement | null> {
    const row = await this.repository.findOne({ where: { idempotencyKey } });
    return row ? this.toDomain(row) : null;
  }

  async findById(id: string): Promise<InventoryMovement | null> {
    const row = await this.repository.findOne({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async settle(id: string, settlement: SettleInventoryMovementInput): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(InventoryMovementOrmEntity)
      .set({
        status: settlement.status,
        quantityBefore: settlement.quantityBefore ?? null,
        quantityAfter: settlement.quantityAfter ?? null,
        refusalReason: settlement.refusalReason ?? null,
        refusalDetail: settlement.refusalDetail ?? null,
      })
      .where('"id" = :id AND "status" = :pending', { id, pending: 'pending' })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async attachQuantities(id: string, quantityAfter: number): Promise<boolean> {
    // Only a row that has no quantities yet and did not end refused / in doubt:
    // an attachment must never rewrite what a settled row already recorded.
    // `quantityDelta` stays what was requested and applied; `quantityBefore` is
    // derived from the master's resulting quantity, so before/after describe the
    // master and a drifted mirror is never attributed to the operator.
    const rows = (await this.repository.query(
      `UPDATE ${TABLE}
         SET "status" = 'applied',
             "quantityBefore" = $2::integer - "quantityDelta",
             "quantityAfter" = $2::integer
       WHERE "id" = $1
         AND "status" IN ('pending', 'applied')
         AND "quantityAfter" IS NULL
       RETURNING "id"`,
      [id, quantityAfter]
    )) as [unknown[], number];
    return (rows[1] ?? 0) > 0;
  }

  async listHistory(
    filters: InventoryMovementFilters,
    pagination: InventoryMovementPagination
  ): Promise<InventoryHistoryRow[]> {
    const query = this.buildHistoryQuery(filters);
    if (query === null) return [];
    const limitIndex = query.params.length + 1;
    const rows = (await this.repository.query(
      `SELECT * FROM (${query.union}) AS history
       ORDER BY history."occurredAt" DESC, history."id" DESC
       LIMIT $${String(limitIndex)} OFFSET $${String(limitIndex + 1)}`,
      [...query.params, pagination.limit, pagination.offset]
    )) as HistoryRawRow[];
    return rows.map((row) => this.toHistoryRow(row));
  }

  async countHistory(filters: InventoryMovementFilters): Promise<number> {
    const query = this.buildHistoryQuery(filters);
    if (query === null) return 0;
    const rows = (await this.repository.query(
      `SELECT COUNT(*)::int AS "total" FROM (${query.union}) AS history`,
      query.params
    )) as Array<{ total: number }>;
    return rows[0]?.total ?? 0;
  }

  async pruneOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new Error('pruneOlderThan: batchSize must be a positive integer');
    }
    // Postgres has no `DELETE ... LIMIT`; the oldest-first sub-select is the
    // standard workaround (the sync_jobs retention shape).
    const result = (await this.repository.query(
      `DELETE FROM ${TABLE}
       WHERE "id" IN (
         SELECT "id" FROM ${TABLE}
         WHERE "occurredAt" < $1
         ORDER BY "occurredAt" ASC
         LIMIT $2
       )`,
      [cutoff, batchSize]
    )) as [unknown[], number];
    return result[1] ?? 0;
  }

  /**
   * Builds the shared `UNION ALL` and its bound parameters, or `null` when the
   * filters make the result provably empty (e.g. reasons on promised-only rows).
   * Both branches use the same `$n` indexes for the same filter.
   */
  private buildHistoryQuery(
    filters: InventoryMovementFilters
  ): { union: string; params: unknown[] } | null {
    const kind = filters.kind ?? 'all';
    const hasReasons = filters.reasons !== undefined && filters.reasons.length > 0;
    // Reservations have no reason and no failure status, so those filters can
    // only ever describe ledger rows.
    const includeMovements = kind !== 'promised';
    const includeReservations =
      kind !== 'movements' && !hasReasons && filters.needsAttention !== true;
    if (!includeMovements && !includeReservations) return null;

    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${String(params.length)}`;
    };

    // Each entry renders one condition for a branch, given that branch's columns.
    interface Columns {
      productId: string;
      variantId: string;
      connection: string;
      time: string;
    }
    const shared: Array<(c: Columns) => string> = [];
    if (filters.productId !== undefined) {
      const p = bind(filters.productId);
      shared.push((c) => `${c.productId} = ${p}`);
    }
    if (filters.productVariantId !== undefined) {
      const p = bind(filters.productVariantId);
      shared.push((c) => `${c.variantId} = ${p}`);
    }
    if (filters.sourceConnectionId !== undefined) {
      const p = bind(filters.sourceConnectionId);
      shared.push((c) => `${c.connection} = ${p}`);
    }
    if (filters.from !== undefined) {
      const p = bind(filters.from);
      shared.push((c) => `${c.time} >= ${p}`);
    }
    if (filters.to !== undefined) {
      const p = bind(filters.to);
      shared.push((c) => `${c.time} <= ${p}`);
    }
    if (filters.search !== undefined && filters.search.trim() !== '') {
      const escaped = filters.search.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const p = bind(`%${escaped}%`);
      shared.push(() => `(pv."sku" ILIKE ${p} ESCAPE '\\' OR p."name" ILIKE ${p} ESCAPE '\\')`);
    }

    const branches: string[] = [];

    if (includeMovements) {
      const where = shared.map((fn) =>
        fn({
          productId: 'm."productId"',
          variantId: 'm."productVariantId"',
          connection: 'm."sourceConnectionId"',
          time: 'm."occurredAt"',
        })
      );
      if (hasReasons) where.push(`m."reason" = ANY(${bind(filters.reasons)})`);
      // A `pending` row older than a few minutes is a stuck claim (a crash or a
      // lost mirror write), so it is surfaced like a failure.
      if (filters.needsAttention === true) {
        where.push(
          `(m."status" IN ('refused', 'in_doubt') OR ` +
            `(m."status" = 'pending' AND m."createdAt" < now() - interval '5 minutes'))`
        );
      }
      branches.push(`
        SELECT 'movement'::text AS "kind", m."id"::text AS "id", m."productId", m."productVariantId",
               pv."sku" AS "sku", p."name" AS "productName", m."locationId", m."sourceConnectionId",
               m."reason", m."status", m."quantityDelta", m."quantityBefore", m."quantityAfter",
               m."sourceKind", m."sourceRef", m."operatorReason", m."note", m."actorUserId",
               m."refusalReason", m."refusalDetail", m."occurredAt",
               CASE WHEN m."sourceKind" = 'order' THEN o."orderSnapshot"->>'orderNumber'
                    WHEN m."sourceKind" = 'return' THEN rt."externalReturnId"
                    ELSE NULL END AS "sourceLabel"
        FROM ${TABLE} m
        LEFT JOIN "order_records" o ON m."sourceKind" = 'order' AND o."internalOrderId" = m."sourceRef"
        LEFT JOIN "returns" rt ON m."sourceKind" = 'return' AND rt."id" = m."sourceRef"
        LEFT JOIN "product_variants" pv ON pv."id" = m."productVariantId"
        LEFT JOIN "products" p ON p."id" = m."productId"
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`);
    }

    if (includeReservations) {
      const where = shared.map((fn) =>
        fn({
          productId: 'ii."productId"',
          variantId: 'ii."productVariantId"',
          connection: 'ii."sourceConnectionId"',
          time: 'COALESCE(r."closedAt", r."createdAt")',
        })
      );
      branches.push(`
        SELECT 'reservation'::text AS "kind", r."id"::text AS "id", ii."productId", ii."productVariantId",
               pv."sku" AS "sku", p."name" AS "productName", ii."locationId", ii."sourceConnectionId",
               NULL::varchar AS "reason", r."status", r."quantity" AS "quantityDelta",
               NULL::integer AS "quantityBefore", NULL::integer AS "quantityAfter",
               'order'::varchar AS "sourceKind", r."orderRecordId" AS "sourceRef",
               NULL::varchar AS "operatorReason", NULL::text AS "note", NULL::text AS "actorUserId",
               NULL::varchar AS "refusalReason", NULL::text AS "refusalDetail",
               COALESCE(r."closedAt", r."createdAt") AS "occurredAt",
               o."orderSnapshot"->>'orderNumber' AS "sourceLabel"
        FROM "reservations" r
        LEFT JOIN "order_records" o ON o."internalOrderId" = r."orderRecordId"
        JOIN "inventory_items" ii ON ii."id" = r."inventoryItemId"
        LEFT JOIN "product_variants" pv ON pv."id" = ii."productVariantId"
        LEFT JOIN "products" p ON p."id" = ii."productId"
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`);
    }

    return { union: branches.join(' UNION ALL '), params };
  }

  private toHistoryRow(row: HistoryRawRow): InventoryHistoryRow {
    return {
      kind: row.kind,
      id: row.id,
      productId: row.productId,
      productVariantId: row.productVariantId,
      sku: row.sku,
      productName: row.productName,
      locationId: row.locationId,
      sourceConnectionId: row.sourceConnectionId,
      reason: narrow<InventoryMovementReason>(InventoryMovementReasonValues, row.reason),
      status: row.status,
      quantityDelta: row.quantityDelta,
      quantityBefore: row.quantityBefore,
      quantityAfter: row.quantityAfter,
      sourceKind: narrow<InventoryMovementSourceKind>(
        InventoryMovementSourceKindValues,
        row.sourceKind
      ),
      sourceRef: row.sourceRef,
      operatorReason: narrow<InventoryMovementOperatorReason>(
        InventoryMovementOperatorReasonValues,
        row.operatorReason
      ),
      note: row.note,
      actorUserId: row.actorUserId,
      refusalReason: row.refusalReason,
      refusalDetail: row.refusalDetail,
      occurredAt: new Date(row.occurredAt),
      sourceLabel: row.sourceLabel,
    };
  }

  private toDomain(row: InventoryMovementOrmEntity): InventoryMovement {
    return new InventoryMovement(
      row.id,
      row.productId,
      row.productVariantId,
      row.locationId,
      row.sourceConnectionId,
      // A value this build does not know is read as the safest reason, never thrown.
      narrow<InventoryMovementReason>(InventoryMovementReasonValues, row.reason) ?? 'master_sync',
      narrow<InventoryMovementStatus>(InventoryMovementStatusValues, row.status) ?? 'in_doubt',
      row.quantityDelta,
      row.quantityBefore,
      row.quantityAfter,
      narrow<InventoryMovementSourceKind>(InventoryMovementSourceKindValues, row.sourceKind) ??
        'master_sync',
      row.sourceRef,
      row.actorUserId,
      narrow<InventoryMovementOperatorReason>(
        InventoryMovementOperatorReasonValues,
        row.operatorReason
      ),
      row.note,
      row.idempotencyKey,
      row.refusalReason,
      row.refusalDetail,
      row.occurredAt,
      row.createdAt
    );
  }
}
