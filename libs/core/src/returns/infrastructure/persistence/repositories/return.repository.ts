/**
 * Return Repository
 *
 * TypeORM implementation of `ReturnRepositoryPort` (#2327, ADR-060).
 *
 * **Ids are minted with `formatInternalId('Return')`**, which falls through to
 * the lowercased default and yields `ol_return_*`. That is deliberate and
 * complete: there is NO `ENTITY_TYPE_ID_PREFIX` override and NO
 * `CoreEntityTypeValues` member, because that union is the *external-mapping*
 * vocabulary and a return is not mapped through `identifier_mappings` —
 * `externalReturnId` is a column on the row itself, resolved by the partial
 * unique index rather than by the mapping service. A later reader should not
 * "fix" the omission. Same shape as `LocationRepository`'s
 * `formatInternalId('Location')` and `ShipmentRepository`'s `'Shipment'`.
 *
 * The header and its lines are written in ONE transaction: a return without its
 * lines is not a return, so a partial write must never be observable — least of
 * all by #2328's update-or-create, which would read the header, find no lines,
 * and conclude the source had sent none.
 *
 * @module libs/core/src/returns/infrastructure/persistence/repositories
 * @implements {ReturnRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { formatInternalId } from '@openlinker/core/identifier-mapping';
import type { RefundReason } from '@openlinker/core/orders/types';
import { Logger } from '@openlinker/shared/logging';
import { ReturnOrmEntity } from '../entities/return.orm-entity';
import { ReturnLineOrmEntity } from '../entities/return-line.orm-entity';
import { ReturnRecord } from '../../../domain/entities/return-record.entity';
import { ReturnLine } from '../../../domain/entities/return-line.entity';
import { narrowRefundReason } from '../../../domain/return-reason.mapper';
import { ReturnPersistenceError } from '../../../domain/exceptions/return-persistence.error';
import type { ReturnRepositoryPort } from '../../../domain/ports/return-repository.port';
import type { CreateReturnRecordInput, ReturnOrigin } from '../../../domain/types/return.types';
import type {
  UpsertReturnRecordInput,
  UpsertReturnResult,
} from '../../../domain/types/return-upsert.types';
import type {
  ReturnCustodyState,
  ReturnDisposition,
  ReturnMoneyState,
} from '../../../domain/types/return-line.types';

@Injectable()
export class ReturnRepository implements ReturnRepositoryPort {
  private readonly logger = new Logger(ReturnRepository.name);

  constructor(
    @InjectRepository(ReturnOrmEntity)
    private readonly returns: Repository<ReturnOrmEntity>,
    @InjectRepository(ReturnLineOrmEntity)
    private readonly lines: Repository<ReturnLineOrmEntity>,
    private readonly dataSource: DataSource
  ) {}

  async create(input: CreateReturnRecordInput): Promise<ReturnRecord> {
    const header = new ReturnOrmEntity();
    header.id = formatInternalId('Return');
    header.sourceConnectionId = input.sourceConnectionId;
    header.externalReturnId = input.externalReturnId;
    header.internalOrderId = input.internalOrderId;
    header.origin = input.origin;
    header.rawStatus = input.rawStatus;
    header.rawPayload = input.rawPayload;
    header.openedAt = input.openedAt;
    header.authorizedAt = input.authorizedAt;
    header.declinedAt = input.declinedAt;
    header.closedAt = input.closedAt;

    const lineEntities = input.lines.map((line) => {
      const entity = new ReturnLineOrmEntity();
      entity.returnId = header.id;
      entity.lineIndex = line.lineIndex;
      entity.externalLineId = line.externalLineId;
      entity.resolvedOrderLineId = line.resolvedOrderLineId;
      entity.offerId = line.offerId;
      entity.sku = line.sku;
      entity.name = line.name;
      entity.reason = line.reason;
      entity.quantityAdvised = line.quantityAdvised;
      entity.note = line.note;
      return entity;
    });

    // One transaction — see the class docblock.
    const { savedHeader, savedLines } = await this.dataSource.transaction(async (manager) => {
      const persistedHeader = await manager.save(ReturnOrmEntity, header);
      const persistedLines =
        lineEntities.length === 0
          ? []
          : await manager.save(ReturnLineOrmEntity, lineEntities);
      return { savedHeader: persistedHeader, savedLines: persistedLines };
    });

    return this.toDomain(savedHeader, savedLines);
  }

  /**
   * Idempotent update-or-create keyed `(sourceConnectionId, externalReturnId)`.
   *
   * Raw SQL rather than `save()`, for the reason `OrderRecordRepository.upsert`
   * is: the write set differs between the INSERT and the UPDATE halves, and a
   * full-object save cannot express that. A read-then-write cannot either —
   * two concurrent ingestions of the same return would both find nothing and
   * both insert.
   *
   * ## Columns absent from BOTH halves, and who owns them
   *
   * Every column not named in the statements below keeps its committed value on
   * conflict, or its DB default on insert. This is the raw-SQL form of the
   * `toOrm` exclusion the order path documents; the enumeration is the contract,
   * so do not add one of these to either half:
   *
   * - `authorizedAt` / `declinedAt` / `closedAt` (#2327, ADR-060) — OPERATOR
   *   decisions. No source reports them, so ingestion's value is always `null`,
   *   and writing that would silently un-authorize a return on every re-poll
   *   with no way for the operator to tell it from a colleague's deliberate
   *   reversal. `return.decline` (#2333) gets its own narrow writer.
   * - `quantityReceived` / `quantityRestocked` / `quantityScrapped`,
   *   `custodyState`, `moneyState`, `disposition`, `receivedAt`, `disposedAt`
   *   (Wave 2) — facts about the operator's own building. A marketplace cannot
   *   observe whether a parcel arrived; re-ingestion resetting a received line
   *   to `advised` would also violate `CHK_return_lines_quantity_ordering` in
   *   the cases where it did not silently lose custody state.
   * - `resolvedOrderLineId` — core-resolved attribution, never adapter-supplied
   *   (the type carries no field for it), and always `null` this wave since
   *   `order_records` has no lines table to point at.
   * - `createdAt` on both tables, and the line's `id` — each records a first
   *   write. Churning a line id would re-key a parcel physically in transit.
   *
   * `sourceConnectionId`, `externalReturnId` and `origin` ARE assigned, but on
   * the INSERT half only: the first write establishes the return's origin, and
   * an `operator_authored` return must never be demoted to `source_ingested` by
   * a later feed.
   */
  async upsertFromSource(input: UpsertReturnRecordInput): Promise<UpsertReturnResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const header = await this.upsertHeader(manager, input);
        await this.upsertLines(manager, header.id, input);
        const lines = await manager.find(ReturnLineOrmEntity, {
          where: { returnId: header.id },
          order: { lineIndex: 'ASC' },
        });
        this.warnOnVanishedLines(header.id, input, lines);
        return { record: this.toDomain(header, lines) };
      });
    } catch (error) {
      if (error instanceof ReturnPersistenceError) {
        throw error;
      }
      throw new ReturnPersistenceError('upsertFromSource', error);
    }
  }

  private async upsertHeader(
    manager: EntityManager,
    input: UpsertReturnRecordInput
  ): Promise<ReturnOrmEntity> {
    const rows = (await manager.query(
      `INSERT INTO "returns" (
         "id", "sourceConnectionId", "externalReturnId", "internalOrderId",
         "origin", "rawStatus", "rawPayload", "openedAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT ("sourceConnectionId", "externalReturnId")
         WHERE "externalReturnId" IS NOT NULL
       DO UPDATE SET
         -- Attribution is MONOTONIC: a later write may name the order, a
         -- failed re-resolve must never re-orphan an attributed return.
         "internalOrderId" = COALESCE(EXCLUDED."internalOrderId", "returns"."internalOrderId"),
         -- The source's own words, refreshed verbatim (latest-wins): a source
         -- that stops sending a status has genuinely stopped saying it.
         "rawStatus" = EXCLUDED."rawStatus",
         "rawPayload" = EXCLUDED."rawPayload",
         -- Opening happened once. A write that omits it must not erase it.
         "openedAt" = COALESCE(EXCLUDED."openedAt", "returns"."openedAt"),
         -- "sourceConnectionId" / "externalReturnId" / "origin" / "createdAt"
         -- are deliberately absent: insert-only, see the method docblock.
         "updatedAt" = now()
       RETURNING *`,
      [
        formatInternalId('Return'),
        input.sourceConnectionId,
        input.externalReturnId,
        input.internalOrderId,
        input.origin,
        input.rawStatus,
        input.rawPayload === null ? null : JSON.stringify(input.rawPayload),
        input.openedAt,
      ]
    )) as unknown;

    if (!Array.isArray(rows) || rows.length === 0) {
      // Unreachable: `ON CONFLICT ... DO UPDATE` always produces a row.
      throw new ReturnPersistenceError(
        'upsertFromSource',
        new Error(
          `Header upsert returned no row (sourceConnectionId=${input.sourceConnectionId}, externalReturnId=${input.externalReturnId})`
        )
      );
    }

    return this.fromRawRow(rows[0] as Record<string, unknown>);
  }

  /**
   * One multi-row `VALUES` statement keyed `(returnId, lineIndex)` — never a
   * delete-and-replace.
   *
   * Replace-all would destroy the Wave-2 custody and money state of a parcel
   * that is physically in the building, and would churn line ids on every
   * re-sync. The per-line upsert converges instead: a re-reported line is
   * refreshed in place, a newly-reported one is appended, and a line the source
   * has stopped reporting is left alone.
   */
  private async upsertLines(
    manager: EntityManager,
    returnId: string,
    input: UpsertReturnRecordInput
  ): Promise<void> {
    if (input.lines.length === 0) {
      // An empty VALUES list is a syntax error, and a source reporting no lines
      // is not an error — skip the statement entirely.
      return;
    }

    const columnsPerRow = 9;
    const values = input.lines
      .map(
        (_line, rowIndex) =>
          `(${Array.from(
            { length: columnsPerRow },
            (__, columnIndex) => `$${rowIndex * columnsPerRow + columnIndex + 1}`
          ).join(', ')})`
      )
      .join(', ');

    const params = input.lines.flatMap((line) => [
      returnId,
      line.lineIndex,
      line.externalLineId,
      line.offerId,
      line.sku,
      line.name,
      line.reason,
      line.quantityAdvised,
      line.note,
    ]);

    await manager.query(
      `INSERT INTO "return_lines" (
         "returnId", "lineIndex", "externalLineId", "offerId", "sku", "name",
         "reason", "quantityAdvised", "note"
       ) VALUES ${values}
       ON CONFLICT ("returnId", "lineIndex") DO UPDATE SET
         "externalLineId" = EXCLUDED."externalLineId",
         "offerId" = EXCLUDED."offerId",
         "sku" = EXCLUDED."sku",
         "name" = EXCLUDED."name",
         "reason" = EXCLUDED."reason",
         "quantityAdvised" = EXCLUDED."quantityAdvised",
         "note" = EXCLUDED."note",
         -- Every Wave-2 column and the line's own id/createdAt are absent by
         -- design — see the enumeration in upsertFromSource's docblock.
         "updatedAt" = now()`,
      params
    );
  }

  /**
   * A line OL knows about that the source has stopped reporting is KEPT, and
   * only warned about.
   *
   * Deleting it would erase the record of a parcel that may already have
   * arrived — the source withdrawing a line says nothing about physical
   * custody. What SHOULD happen to such a line is a Wave-2 decision (it may
   * warrant a `not_returned` custody transition); until then the honest
   * behaviour is to keep the row and make the divergence visible.
   */
  private warnOnVanishedLines(
    returnId: string,
    input: UpsertReturnRecordInput,
    persisted: ReturnLineOrmEntity[]
  ): void {
    const reported = new Set(input.lines.map((line) => line.lineIndex));
    const vanished = persisted
      .filter((line) => !reported.has(line.lineIndex))
      .map((line) => line.lineIndex);

    if (vanished.length > 0) {
      this.logger.warn(
        `Return ${returnId}: source no longer reports line index(es) ${vanished.join(', ')} — kept, not deleted (custody may already have changed)`
      );
    }
  }

  /**
   * Project a `RETURNING *` row onto a `ReturnOrmEntity`, resetting the three
   * OL-owned timestamps the upsert does not write.
   *
   * The reset is the point, not tidiness: `RETURNING *` carries the row's TRUE
   * `authorizedAt` / `declinedAt` / `closedAt`, but `upsertFromSource`'s
   * contract (repeated on the port) promises callers that those read empty and
   * must be re-read via `findById`. Passing the true values through would make
   * the return value inconsistent with the documented contract, and
   * inconsistently so — only on the conflict path, since a first insert has
   * nothing to carry.
   */
  private fromRawRow(row: Record<string, unknown>): ReturnOrmEntity {
    const entity = Object.assign(new ReturnOrmEntity(), row);
    entity.authorizedAt = null;
    entity.declinedAt = null;
    entity.closedAt = null;
    return entity;
  }

  async findById(id: string): Promise<ReturnRecord | null> {
    const header = await this.returns.findOne({ where: { id } });
    if (!header) {
      return null;
    }
    const lines = await this.lines.find({
      where: { returnId: id },
      order: { lineIndex: 'ASC' },
    });
    return this.toDomain(header, lines);
  }

  async findByExternalId(
    sourceConnectionId: string,
    externalReturnId: string
  ): Promise<ReturnRecord | null> {
    const header = await this.returns.findOne({
      where: { sourceConnectionId, externalReturnId },
    });
    if (!header) {
      return null;
    }
    const lines = await this.lines.find({
      where: { returnId: header.id },
      order: { lineIndex: 'ASC' },
    });
    return this.toDomain(header, lines);
  }

  /**
   * Headers only, by design — the orphan bucket is a triage list, and hydrating
   * every line for every row would be an N+1 for data the list does not render.
   * A caller that needs the lines has the id and can call `findById`.
   */
  async listOrphans(limit: number, offset: number): Promise<ReturnRecord[]> {
    const headers = await this.returns.find({
      where: { internalOrderId: IsNull() },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return headers.map((header) => this.toDomain(header, []));
  }

  private toDomain(header: ReturnOrmEntity, lines: ReturnLineOrmEntity[]): ReturnRecord {
    return new ReturnRecord(
      header.id,
      header.sourceConnectionId,
      header.externalReturnId,
      header.internalOrderId,
      header.origin as ReturnOrigin,
      header.rawStatus,
      header.rawPayload,
      header.openedAt,
      header.authorizedAt,
      header.declinedAt,
      header.closedAt,
      header.createdAt,
      header.updatedAt,
      lines.map((line) => this.toLineDomain(line))
    );
  }

  private toLineDomain(entity: ReturnLineOrmEntity): ReturnLine {
    return new ReturnLine(
      entity.id,
      entity.returnId,
      entity.lineIndex,
      entity.externalLineId,
      entity.resolvedOrderLineId,
      entity.offerId,
      entity.sku,
      entity.name,
      this.toRefundReason(entity.reason),
      // `integer` comes back from pg as a number already, but a DEFAULT-ed
      // column read through an older row could be undefined; coerce once here
      // so no consumer ever sees a stringly-typed or absent counter.
      Number(entity.quantityAdvised),
      Number(entity.quantityReceived),
      Number(entity.quantityRestocked),
      Number(entity.quantityScrapped),
      entity.custodyState as ReturnCustodyState,
      entity.moneyState as ReturnMoneyState,
      entity.disposition as ReturnDisposition | null,
      entity.receivedAt,
      entity.disposedAt,
      entity.note,
      entity.createdAt,
      entity.updatedAt
    );
  }

  /**
   * Typed, fail-safe read of the stored `reason` column.
   *
   * The rule itself lives in `domain/return-reason.mapper.ts` (#2328) — this
   * method is only the logging wrapper around it, because the shared rule is
   * pure and a repository read is where the warning belongs. A row written
   * before a future reason was removed from `RefundReasonValues`, or inserted
   * by a caller that bypassed the DTO validator, degrades to `'other'` with a
   * warning rather than handing out a value outside the union.
   */
  private toRefundReason(rawReason: string): RefundReason {
    const narrowed = narrowRefundReason(rawReason);
    if (narrowed !== null) {
      return narrowed;
    }
    this.logger.warn(`Unrecognised return reason "${rawReason}" — falling back to "other"`);
    return 'other';
  }
}
