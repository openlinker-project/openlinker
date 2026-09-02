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
import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { formatInternalId } from '@openlinker/core/identifier-mapping';
import type { RefundReason } from '@openlinker/core/orders/types';
import { Logger } from '@openlinker/shared/logging';
import { ReturnOrmEntity } from '../entities/return.orm-entity';
import { ReturnLineOrmEntity } from '../entities/return-line.orm-entity';
import { ReturnLineEventOrmEntity } from '../entities/return-line-event.orm-entity';
import { ReturnRecord } from '../../../domain/entities/return-record.entity';
import { ReturnLine } from '../../../domain/entities/return-line.entity';
import { ReturnLineEvent } from '../../../domain/entities/return-line-event.entity';
import { narrowRefundReason } from '../../../domain/return-reason.mapper';
import { ReturnPersistenceError } from '../../../domain/exceptions/return-persistence.error';
import type {
  ReturnAttributionMatch,
  ReturnLineWriteDecision,
  ReturnRepositoryPort,
} from '../../../domain/ports/return-repository.port';
import type { CreateReturnRecordInput, ReturnOrigin } from '../../../domain/types/return.types';
import type {
  ReturnTimelineContext,
  ReturnTimelineEntriesForOrder,
  ReturnTimelineEntry,
} from '../../../domain/types/return-timeline-entry.types';
import type {
  UpsertReturnRecordInput,
  UpsertReturnResult,
} from '../../../domain/types/return-upsert.types';
import type {
  ReturnSourceSweepFilter,
  ReturnSweepCandidate,
} from '../../../domain/types/return-sweep.types';
import type { ReturnReattributionCandidate } from '../../../domain/types/return-reattribution.types';
import type {
  ReturnBucketCounts,
  ReturnListFilter,
  ReturnStageCounts,
} from '../../../domain/types/return-query.types';
import { ReturnSegmentValues } from '../../../domain/types/return-segment.types';
import type {
  ReturnSegment,
  ReturnSegmentCounts,
} from '../../../domain/types/return-segment.types';
import { ReturnStageValues } from '../../../domain/types/return-stage.types';
import type {
  ReturnStage,
  ReturnStageCounters,
} from '../../../domain/types/return-stage.types';
import {
  REFUND_ATTEMPTABLE_MONEY_STATES,
  type ReturnCustodyState,
  type ReturnDisposition,
  type ReturnMoneyState,
} from '../../../domain/types/return-line.types';
import type { ReturnCustodyOutcome } from '../../../domain/domain-services/return-custody-transitions.domain-service';
import {
  ReturnLineEventKindValues,
  type CreateReturnLineEventInput,
  type ReturnLineEventKind,
  type ReturnRestockBlockReason,
  type ReturnRestockState,
  type RestockedBy,
  type SettleReturnLineEventInput,
} from '../../../domain/types/return-line-event.types';
import { ReturnLineNotFoundError } from '../../../domain/exceptions/return-line-not-found.error';

/**
 * What one aggregate row supplies for a list row (#2377 counters, #2381 flag).
 *
 * The flag is a SIBLING of the counters rather than a member, because the fetch
 * mechanism must not dictate the projection shape — see
 * `ReturnRecord.restockBlocked`.
 */
interface ReturnRowAggregate {
  counters: ReturnStageCounters;
  restockBlocked: boolean;
}
import {
  buildAuthorityAttentionPayload,
  buildAuthorityAttentionUpsertSql,
  readAuthorityAttentionEntries,
} from '@openlinker/core/fulfillment-authority';
import type {
  AuthorityAttentionOutcome,
  AuthorityAttentionProducer,
} from '@openlinker/core/fulfillment-authority';

@Injectable()
export class ReturnRepository implements ReturnRepositoryPort {
  /**
   * The counters a return with no lines carries on a read that DID load them.
   *
   * Distinct from `ReturnRecord.counters === null`, which means the read loaded
   * none at all. Zeroes here are a fact about the return; `null` is a fact about
   * the query.
   */
  private static readonly EMPTY_COUNTERS: ReturnStageCounters = {
    lineCount: 0,
    notReturnedLineCount: 0,
    quantityAdvised: 0,
    notReturnedQuantityAdvised: 0,
    quantityReceived: 0,
    quantityRestocked: 0,
    quantityScrapped: 0,
  };

  /**
   * The per-return counter rollup, as a joinable subquery (#2377).
   *
   * The same six numbers `aggregateCounters` reads for the page, expressed in
   * SQL so the stage filter and the stage counts can test them without loading
   * a single line row.
   */
  private static readonly COUNTERS_SUBQUERY = `(
    SELECT l."returnId" AS "returnId",
           COUNT(*) AS "lineCount",
           COUNT(*) FILTER (WHERE l."custodyState" = 'not_returned') AS "notReturnedLineCount",
           COALESCE(SUM(l."quantityAdvised"), 0) AS "quantityAdvised",
           COALESCE(SUM(l."quantityAdvised") FILTER (WHERE l."custodyState" = 'not_returned'), 0) AS "notReturnedQuantityAdvised",
           COALESCE(SUM(l."quantityReceived"), 0) AS "quantityReceived",
           COALESCE(SUM(l."quantityRestocked"), 0) AS "quantityRestocked",
           COALESCE(SUM(l."quantityScrapped"), 0) AS "quantityScrapped",
           -- #2378 segment inputs. Kept in the SAME subquery as the #2377
           -- counters so the strip, the filter and the stage all read one scan.
           COUNT(*) FILTER (WHERE l."custodyState" IN ('advised', 'in_transit')) AS "awaitingArrivalLineCount",
           COUNT(*) FILTER (WHERE l."moneyState" IN ('pending', 'in_doubt')) AS "moneyPendingLineCount"
      FROM return_lines l
     GROUP BY l."returnId"
  )`;

  /**
   * The orphan rule, in SQL, ONCE.
   *
   * `ReturnRecord.isOrphan()` is the single definition (#2332's docblock forbids
   * a second one — the bucket count, the trigger guard and the reconcile
   * candidate query all derive from it). SQL cannot call it, so this constant is
   * how the same rule reaches the bucket count, the bucket filter arm and the
   * `orphans` segment without three hand-written copies that happen to agree.
   */
  private static readonly ORPHAN_PREDICATE = `r."internalOrderId" IS NULL`;

  /**
   * Whether the return holds a restock the master refused and nobody attested.
   *
   * The predicate is `findOutstandingRestockEventsForReturn`'s, and that method
   * is the authority on what "outstanding" means — attestation does not stamp
   * the blocked act, it FLIPS its `restockState` to `handled_manually` (see
   * `ReturnCustodyService.markStockHandledManually`), so state membership is the
   * whole test. An `attestedByEventId IS NULL` clause would be backwards: it
   * would keep every settled block and drop the attestation.
   *
   * **A function of the correlating expression, not a constant (#2381)**, because
   * two callers need it in two scopes: the list query has `r.id`, while
   * `aggregateCounters` groups over `return_lines` and has only `l."returnId"`.
   * Copying the SQL for the second scope would be two rules that agree today —
   * which is what `orphans` cost a round in #2378 — so the badge and the
   * `restock_blocked` segment go through this one function instead and cannot
   * disagree about the same return.
   */
  private static restockBlockedExists(returnIdExpr: string): string {
    return `EXISTS (
    SELECT 1 FROM return_line_events ev
     WHERE ev."returnId" = ${returnIdExpr}
       AND ev."restockState" IN ('blocked', 'in_doubt')
  )`;
  }

  /** The segment/filter scope, correlated on the list query's own alias. */
  private static readonly RESTOCK_BLOCKED_EXISTS =
    ReturnRepository.restockBlockedExists('r.id');

  /** Units still expected — see `expectedQuantity`. LEFT JOIN, so COALESCE. */
  private static readonly SQL_EXPECTED =
    `(COALESCE(sc."quantityAdvised", 0) - COALESCE(sc."notReturnedQuantityAdvised", 0))`;

  private static readonly SQL_RECEIVED = `COALESCE(sc."quantityReceived", 0)`;

  private static readonly SQL_UNDISPOSED =
    `(COALESCE(sc."quantityReceived", 0) - (COALESCE(sc."quantityRestocked", 0) + COALESCE(sc."quantityScrapped", 0)))`;

  /**
   * The SQL twin of `deriveReturnStage` (#2377), arm for arm.
   *
   * Mirrors `LIFECYCLE_PHASE_PREDICATES` (#2311): a `Record` of fragments the
   * `CASE` is BUILT from by iterating the vocabulary, never a hand-written
   * ladder restating the precedence a second time.
   *
   * `scripts/check-return-stage-mirror.mjs` pins this STRUCTURALLY — same keys,
   * same order, still consumed by a `ReturnStageValues.map(`. It deliberately
   * does NOT claim each fragment is semantically its TS arm: the two are
   * different languages over different shapes, and a script asserting
   * equivalence would be claiming something it cannot check. The shared
   * `RETURN_STAGE_FIXTURES` table is what proves meaning.
   */
  private static readonly RETURN_STAGE_PREDICATES: Record<ReturnStage, string> = {
    // 1. The SOURCE said it refused the return; that outranks every custody fact.
    declined: `r."declinedAt" IS NOT NULL`,
    // 2. Every line written off as never arriving. Needs the line COUNTS — no
    //    combination of quantity sums can express "every line".
    not_returned: `COALESCE(sc."lineCount", 0) > 0 AND COALESCE(sc."notReturnedLineCount", 0) = COALESCE(sc."lineCount", 0)`,
    // 3. Outranks `disposed` deliberately: units may still turn up, so calling a
    //    partly-arrived return "Disposed" would say it is closed when it is not.
    partially_received: `${ReturnRepository.SQL_RECEIVED} > 0 AND ${ReturnRepository.SQL_RECEIVED} < ${ReturnRepository.SQL_EXPECTED}`,
    // 4. Everything expected arrived; some of it is still undisposed.
    received_awaiting_disposition: `${ReturnRepository.SQL_RECEIVED} >= ${ReturnRepository.SQL_EXPECTED} AND ${ReturnRepository.SQL_UNDISPOSED} > 0`,
    // 5. Everything expected arrived and all of it was disposed of.
    disposed: `${ReturnRepository.SQL_RECEIVED} > 0 AND ${ReturnRepository.SQL_RECEIVED} >= ${ReturnRepository.SQL_EXPECTED}`,
    // 6. The declared fallback arm, matching the TS function's final `return`.
    awaiting_parcel: 'TRUE',
  };

  /**
   * The six segment predicates (#2378, spec § 4.1).
   *
   * **Independent booleans, NOT a `CASE` ladder** — unlike `RETURN_STAGE_PREDICATES`,
   * which is a partition. Segments overlap: one return can satisfy several at
   * once, and `all_open` deliberately overlaps almost everything. There is
   * therefore no precedence here and no `ELSE` arm; each is counted on its own.
   */
  private static readonly SEGMENT_PREDICATES: Record<ReturnSegment, string> = {
    // Custody has not finished arriving: nothing/partly here, or units still expected.
    needs_receiving: `(COALESCE(sc."awaitingArrivalLineCount", 0) > 0 OR ${ReturnRepository.SQL_RECEIVED} < ${ReturnRepository.SQL_EXPECTED})`,
    // Received units neither restocked nor scrapped.
    needs_disposition: `${ReturnRepository.SQL_UNDISPOSED} > 0`,
    // A master write refused and nobody has attested.
    restock_blocked: ReturnRepository.RESTOCK_BLOCKED_EXISTS,
    // Money `pending` OR `in_doubt` on any line — two states, which is why this
    // is a segment and not a value of the single-valued `money` filter.
    money_pending: `COALESCE(sc."moneyPendingLineCount", 0) > 0`,
    // The SAME rule `ReturnRecord.isOrphan()` states, reached through one constant.
    orphans: ReturnRepository.ORPHAN_PREDICATE,
    // Still needing something on EITHER rail. The one segment whose predicate
    // spans both, which is why the money aggregate lives in the counters
    // subquery rather than in a join of its own.
    all_open: `(COALESCE(sc."awaitingArrivalLineCount", 0) > 0 OR ${ReturnRepository.SQL_UNDISPOSED} > 0 OR ${ReturnRepository.SQL_RECEIVED} < ${ReturnRepository.SQL_EXPECTED} OR COALESCE(sc."moneyPendingLineCount", 0) > 0)`,
  };

  private static readonly RETURN_STAGE_EXPR = `CASE ${ReturnStageValues.map(
    (stage) => `WHEN ${ReturnRepository.RETURN_STAGE_PREDICATES[stage]} THEN '${stage}'`
  ).join(' ')} ELSE 'awaiting_parcel' END`;

  private readonly logger = new Logger(ReturnRepository.name);

  constructor(
    @InjectRepository(ReturnOrmEntity)
    private readonly returns: Repository<ReturnOrmEntity>,
    @InjectRepository(ReturnLineOrmEntity)
    private readonly lines: Repository<ReturnLineOrmEntity>,
    @InjectRepository(ReturnLineEventOrmEntity)
    private readonly lineEvents: Repository<ReturnLineEventOrmEntity>,
    private readonly dataSource: DataSource
  ) {}

  async create(input: CreateReturnRecordInput): Promise<ReturnRecord> {
    const header = new ReturnOrmEntity();
    header.id = formatInternalId('Return');
    header.sourceConnectionId = input.sourceConnectionId;
    header.externalReturnId = input.externalReturnId;
    header.internalOrderId = input.internalOrderId;
    header.externalOrderId = input.externalOrderId;
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
        lineEntities.length === 0 ? [] : await manager.save(ReturnLineOrmEntity, lineEntities);
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
         "externalOrderId", "origin", "rawStatus", "rawPayload", "openedAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT ("sourceConnectionId", "externalReturnId")
         WHERE "externalReturnId" IS NOT NULL
       DO UPDATE SET
         -- Attribution is MONOTONIC: a later write may name the order, a
         -- failed re-resolve must never re-orphan an attributed return.
         "internalOrderId" = COALESCE(EXCLUDED."internalOrderId", "returns"."internalOrderId"),
         -- The re-attribution key (#2332). COALESCE, not latest-wins: a source that
         -- stops naming the order has not made the return belong to a different one,
         -- and blanking it would destroy the only thing the reconcile can resolve from.
         "externalOrderId" = COALESCE(EXCLUDED."externalOrderId", "returns"."externalOrderId"),
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
        input.externalOrderId,
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

  /**
   * The orphan attention number (#2332) — same predicate and same partial index as
   * `listOrphans`, asked as a count.
   */
  async countOrphans(): Promise<number> {
    return this.returns.count({ where: { internalOrderId: IsNull() } });
  }

  /**
   * One page of the general returns list (#2334).
   *
   * Headers only; `toDomain(header, [])` for the reason `listOrphans` gives.
   */
  async listReturns(
    filter: ReturnListFilter,
    limit: number,
    offset: number
  ): Promise<ReturnRecord[]> {
    const headers = await this.buildListQuery(filter)
      // PROPERTY paths, not raw quoted SQL. `take`/`skip` plus ANY join sends
      // TypeORM down its distinct-pagination path, which resolves each ORDER BY
      // term back to column metadata — a raw `r."createdAt"` string has none, and
      // the read throws `Cannot read properties of undefined (reading
      // 'databaseName')`. Unjoined this never fired, so the #2377 stage filter is
      // what made the ordering style load-bearing.
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .take(limit)
      .skip(offset)
      .getMany();

    // #2377: the derived stage needs a per-return counter rollup, and the header
    // read deliberately loads no lines. One aggregate query over the page's ids
    // rather than a per-row lookup — and rather than hydrating every line of
    // every row to compute six integers.
    const aggregates = await this.aggregateCounters(headers.map((header) => header.id));

    return headers.map((header) =>
      this.toDomain(
        header,
        [],
        aggregates.get(header.id)?.counters ?? ReturnRepository.EMPTY_COUNTERS,
        // `false`, not `null`, when the row simply has no lines: the aggregate
        // genuinely reports "nothing is blocked here". `null` is reserved for a
        // read that did not ASK — see `ReturnRecord.restockBlocked`.
        aggregates.get(header.id)?.restockBlocked ?? false
      )
    );
  }

  /**
   * The six numbers the derived stage reads, per return (#2377).
   *
   * ONE aggregate query over the whole page's ids — not a per-row lookup, and
   * not an N+1. Said plainly because a query inside a list read is exactly what
   * a reader scanning for N+1s stops on.
   *
   * `notReturnedQuantityAdvised` is the one that is easy to leave out and the one
   * the stage cannot be correct without: `advised` in the stage arms means STILL
   * EXPECTED, not originally announced — see `expectedQuantity`.
   *
   * A return whose lines all vanished still gets a row from the caller's
   * `EMPTY_COUNTERS` fallback rather than `null`: on THIS read the counters were
   * loaded, and the honest answer for a return with no lines is zeroes.
   */
  private async aggregateCounters(
    returnIds: string[]
  ): Promise<Map<string, ReturnRowAggregate>> {
    if (returnIds.length === 0) {
      return new Map();
    }

    const rows = await this.lines
      .createQueryBuilder('l')
      .select('l."returnId"', 'returnId')
      .addSelect('COUNT(*)', 'lineCount')
      .addSelect(`COUNT(*) FILTER (WHERE l."custodyState" = 'not_returned')`, 'notReturnedLineCount')
      .addSelect('COALESCE(SUM(l."quantityAdvised"), 0)', 'quantityAdvised')
      .addSelect(
        `COALESCE(SUM(l."quantityAdvised") FILTER (WHERE l."custodyState" = 'not_returned'), 0)`,
        'notReturnedQuantityAdvised'
      )
      .addSelect('COALESCE(SUM(l."quantityReceived"), 0)', 'quantityReceived')
      .addSelect('COALESCE(SUM(l."quantityRestocked"), 0)', 'quantityRestocked')
      .addSelect('COALESCE(SUM(l."quantityScrapped"), 0)', 'quantityScrapped')
      // #2381 — the row's blocked flag. It rides THIS query, not the paged one:
      // `listReturns` ends in `getMany()`, which hydrates entities and silently
      // discards a raw `addSelect`, so the column would be `undefined` forever
      // with no error anywhere. Correlated on the GROUP BY key, so it neither
      // fans out the COUNT(*)s (a LEFT JOIN to events would) nor adds a join to
      // the paged read — which also keeps that read clear of TypeORM's
      // distinct-pagination path. See docs/lessons.md.
      .addSelect(ReturnRepository.restockBlockedExists('l."returnId"'), 'restockBlocked')
      .where('l."returnId" IN (:...returnIds)', { returnIds })
      .groupBy('l."returnId"')
      // `string | boolean`: COUNT/SUM come back as strings, but the pg driver
      // hands a real `boolean` back for an EXISTS. Typing it `string` alone made
      // the honest comparison below a compile error and would have pushed it
      // towards `Boolean(row.x)`, which is `true` for the string 'false'.
      .getRawMany<Record<string, string | boolean>>();

    // pg returns COUNT/SUM as STRINGS; leaving them stringly-typed would make
    // every comparison in `deriveReturnStage` a lexicographic one — '10' < '9'
    // — which throws nothing and puts a plausible, wrong stage on the screen.
    return new Map(
      rows.map((row) => [
        row.returnId as string,
        {
          // A SIBLING of the counters, never a member: see
          // `ReturnRecord.restockBlocked`. pg renders booleans as 'true'/'false'
          // through the raw path, so this is a string comparison, not `Boolean(row.x)`
          // — `Boolean('false')` is `true`, which would mark every row blocked.
          restockBlocked: row.restockBlocked === true || row.restockBlocked === 'true',
          counters: {
            lineCount: Number(row.lineCount as string),
            notReturnedLineCount: Number(row.notReturnedLineCount as string),
            quantityAdvised: Number(row.quantityAdvised as string),
            notReturnedQuantityAdvised: Number(row.notReturnedQuantityAdvised as string),
            quantityReceived: Number(row.quantityReceived as string),
            quantityRestocked: Number(row.quantityRestocked as string),
            quantityScrapped: Number(row.quantityScrapped as string),
          },
        },
      ])
    );
  }

  /**
   * The attribution partition over one filter scope (#2334).
   *
   * `COUNT(*)` and a `FILTER (WHERE ...)` aggregate in ONE statement — the two
   * numbers come from the same scan, so no concurrent write can leave the chip
   * row failing to add up. `attributed` is subtracted, never counted (see
   * `ReturnBucketCounts`).
   *
   * `getRawOne` returns pg `bigint`s as STRINGS, so both are `Number()`-ed once
   * here; leaving them stringly-typed would make `total - orphan` a string
   * concatenation and put a plausible, badly wrong number on the operator's
   * screen rather than throwing.
   */
  async countReturnsByBucket(filter: ReturnListFilter): Promise<ReturnBucketCounts> {
    const row = await this.buildListQuery(filter)
      .select('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE ${ReturnRepository.ORPHAN_PREDICATE})`, 'orphan')
      .getRawOne<{ total: string; orphan: string }>();

    const total = Number(row?.total ?? 0);
    const orphan = Number(row?.orphan ?? 0);

    return { total, orphan, attributed: total - orphan };
  }

  /**
   * How many returns sit in each derived stage, over one filter scope (#2377).
   *
   * Every bucket tests the SAME `RETURN_STAGE_EXPR` the filter arm tests, so no
   * per-stage count can drift from the rows the filter would return — the
   * property `countByLifecyclePhase` has for the same reason.
   *
   * **The caller strips `stage` from the filter before calling this.** See
   * `ReturnStageCounts`: the count for the dimension you are not looking at must
   * stay truthful, or every chip shows the count of the stage already selected.
   */
  async countReturnsByStage(filter: ReturnListFilter): Promise<ReturnStageCounts> {
    // The scoping rule, enforced HERE rather than trusted to every caller: a
    // count computed with `stage` still applied makes every chip report the
    // count of the stage already selected. Stripping it here also guarantees
    // `buildListQuery` adds no second join under the same alias.
    const scoped: ReturnListFilter = { ...filter };
    delete scoped.stage;
    const query = ReturnRepository.joinCountersOnce(this.buildListQuery(scoped)).select(
      'COUNT(*)',
      'total'
    );

    for (const stage of ReturnStageValues) {
      query.addSelect(
        `COUNT(*) FILTER (WHERE ${ReturnRepository.RETURN_STAGE_EXPR} = '${stage}')`,
        stage
      );
    }

    const row = await query.getRawOne<Record<string, string>>();

    // Same `Number()` discipline `countReturnsByBucket` documents: pg reports
    // these as strings, and a stringly-typed count silently concatenates.
    const byStage = Object.fromEntries(
      ReturnStageValues.map((stage) => [stage, Number(row?.[stage] ?? 0)])
    ) as Record<ReturnStage, number>;

    return { total: Number(row?.total ?? 0), byStage };
  }

  /**
   * How many returns sit in each operator-facing segment (#2378, spec § 4.1).
   *
   * **`total` is NOT the sum of `bySegment`** — segments overlap by design (see
   * `ReturnSegmentValues`). It is the row count of the segment-less scope, which
   * is what the strip's `All returns` card renders. No sum assertion exists here
   * or anywhere else, deliberately.
   *
   * **Strips `segment` from the filter itself**, exactly as `countReturnsByStage`
   * strips `stage`: the count for the dimension you are NOT looking at must stay
   * truthful, or every card reports the count of the segment already selected.
   * That defence already survived a caller forgetting it once.
   */
  async countReturnsBySegment(filter: ReturnListFilter): Promise<ReturnSegmentCounts> {
    const scoped: ReturnListFilter = { ...filter };
    delete scoped.segment;

    const query = ReturnRepository.joinCountersOnce(this.buildListQuery(scoped)).select(
      'COUNT(*)',
      'total'
    );

    for (const segment of ReturnSegmentValues) {
      query.addSelect(
        `COUNT(*) FILTER (WHERE ${ReturnRepository.SEGMENT_PREDICATES[segment]})`,
        segment
      );
    }

    const row = await query.getRawOne<Record<string, string>>();

    // pg reports COUNT as a STRING; a stringly-typed count silently concatenates.
    const bySegment = Object.fromEntries(
      ReturnSegmentValues.map((segment) => [segment, Number(row?.[segment] ?? 0)])
    ) as Record<ReturnSegment, number>;

    return { total: Number(row?.total ?? 0), bySegment };
  }

  /**
   * The one predicate builder both #2334 reads share.
   *
   * Shared for the reason `buildReattributionQuery` and `buildSweepQuery` are:
   * a page and its total that build their own `where` clauses are one edit away
   * from filtering differently, and the symptom would be a count that does not
   * match the rows underneath it — which reads as a data bug rather than a
   * query bug.
   *
   * An absent filter field adds NO arm (`ReturnListFilter` rule 1).
   */
  private buildListQuery(filter: ReturnListFilter): SelectQueryBuilder<ReturnOrmEntity> {
    const query = this.returns.createQueryBuilder('r');

    if (filter.sourceConnectionId !== undefined) {
      query.andWhere('r."sourceConnectionId" = :sourceConnectionId', {
        sourceConnectionId: filter.sourceConnectionId,
      });
    }

    if (filter.bucket === 'orphan') {
      query.andWhere(ReturnRepository.ORPHAN_PREDICATE);
    } else if (filter.bucket === 'attributed') {
      query.andWhere(`NOT (${ReturnRepository.ORPHAN_PREDICATE})`);
    }

    if (filter.createdFrom !== undefined) {
      query.andWhere('r."createdAt" >= :createdFrom', { createdFrom: filter.createdFrom });
    }

    if (filter.createdTo !== undefined) {
      query.andWhere('r."createdAt" <= :createdTo', { createdTo: filter.createdTo });
    }

    // `money` and `reason` read `return_lines` DIRECTLY rather than the counters
    // subquery, unlike every other arm added in #2378: neither is expressible as
    // an aggregate ("ANY line has this state" is existence, not a sum), and
    // EXISTS short-circuits on the first matching line.
    if (filter.money !== undefined) {
      query.andWhere(
        `EXISTS (SELECT 1 FROM return_lines ml WHERE ml."returnId" = r.id AND ml."moneyState" = :money)`,
        { money: filter.money }
      );
    }

    if (filter.reason !== undefined) {
      query.andWhere(
        `EXISTS (SELECT 1 FROM return_lines rl WHERE rl."returnId" = r.id AND rl."reason" = :reason)`,
        { reason: filter.reason }
      );
    }

    // `openedAt`, NOT `createdAt`. The source's own instant, never OL's ingestion
    // clock — see `ReturnListFilter.openedFrom`.
    if (filter.openedFrom !== undefined) {
      query.andWhere('r."openedAt" >= :openedFrom', { openedFrom: filter.openedFrom });
    }

    if (filter.openedTo !== undefined) {
      query.andWhere('r."openedAt" <= :openedTo', { openedTo: filter.openedTo });
    }

    // `segment` and `stage` both read the counters subquery, and so do both count
    // readers — which call `buildListQuery` FIRST and then need `sc` themselves.
    // Every one of those paths goes through `joinCountersOnce`, because a second
    // `sc` alias is a TypeORM duplicate-alias error on ordinary requests: clicking
    // a card and then narrowing by stage, or counting segments while a stage
    // filter is active. Joined only when something needs it, so the plain list
    // read pays nothing.
    if (filter.segment !== undefined || filter.stage !== undefined) {
      ReturnRepository.joinCountersOnce(query);
    }

    if (filter.segment !== undefined) {
      // The SAME predicate `countReturnsBySegment` counts on, so a filtered page
      // can never disagree with its own card.
      query.andWhere(ReturnRepository.SEGMENT_PREDICATES[filter.segment]);
    }

    if (filter.stage !== undefined) {
      // The SAME expression `countReturnsByStage` buckets on — one expression,
      // never per-arm predicates that can drift from their own counts.
      query.andWhere(`${ReturnRepository.RETURN_STAGE_EXPR} = :stage`, { stage: filter.stage });
    }

    return query;
  }

  /**
   * Join the counters subquery, at most once per query builder.
   *
   * Idempotent by inspection rather than by convention: four independent paths
   * can each need `sc` on the same builder (the `segment` arm, the `stage` arm,
   * `countReturnsByStage`, `countReturnsBySegment`), and TypeORM throws on a
   * duplicate alias. Making the join self-checking means no caller has to know
   * what the others did.
   */
  private static joinCountersOnce(
    query: SelectQueryBuilder<ReturnOrmEntity>
  ): SelectQueryBuilder<ReturnOrmEntity> {
    const alreadyJoined = query.expressionMap.joinAttributes.some(
      (join) => join.alias.name === 'sc'
    );
    if (alreadyJoined) {
      return query;
    }
    return query.leftJoin(ReturnRepository.COUNTERS_SUBQUERY, 'sc', 'sc."returnId" = r.id');
  }

  /**
   * One page of re-attribution candidates (#2332).
   *
   * `createdAt DESC` — the opposite direction to `findForSourceSweep`, deliberately; see
   * the port docblock for why "whose order most likely just arrived" is a
   * newest-first question while "who has waited longest for a re-read" is not.
   */
  async findOrphansForReattribution(
    sourceConnectionId: string,
    limit: number,
    offset: number
  ): Promise<ReturnReattributionCandidate[]> {
    const rows = await this.buildReattributionQuery(sourceConnectionId)
      .select(['r.id', 'r.externalOrderId'])
      .orderBy('r."createdAt"', 'DESC')
      .addOrderBy('r.id', 'ASC')
      // `limit`/`offset` rather than `take`/`skip` for the same reason
      // `findForSourceSweep` uses them: this is a raw projection with no joins, so the
      // direct SQL clauses are what it means.
      .limit(limit)
      .offset(offset)
      .getRawMany<{ r_id: string; r_externalOrderId: string }>();

    return rows.map((row) => ({ id: row.r_id, externalOrderId: row.r_externalOrderId }));
  }

  async countOrphansForReattribution(sourceConnectionId: string): Promise<number> {
    return this.buildReattributionQuery(sourceConnectionId).getCount();
  }

  /**
   * The single WHERE the candidate page and its count share — one builder, two callers,
   * so a filter can never be applied to the page but not the total (which would make the
   * scan offset wrap against a set it is not paging through).
   */
  private buildReattributionQuery(sourceConnectionId: string): SelectQueryBuilder<ReturnOrmEntity> {
    return this.returns
      .createQueryBuilder('r')
      .where('r."sourceConnectionId" = :connectionId', { connectionId: sourceConnectionId })
      .andWhere('r."internalOrderId" IS NULL')
      .andWhere('r."externalOrderId" IS NOT NULL');
  }

  /**
   * Fill in an orphan's attribution, if and only if it is still an orphan (#2332).
   *
   * Conditional UPDATE, `affected > 0` as the answer — see the port docblock for why the
   * `IS NULL` arm is both the concurrency seam and the monotonicity guarantee.
   * `updatedAt` is set explicitly because `@UpdateDateColumn` is TypeORM-managed and a
   * query-builder update bypasses it.
   */
  async claimAttribution(
    id: string,
    internalOrderId: string,
    match?: ReturnAttributionMatch
  ): Promise<boolean> {
    try {
      // With `match` absent the statement is byte-identical to its pre-#2372 form —
      // same predicate, same SET list — which is what keeps the #2332 reconcile's
      // two-argument call an untouched path rather than a re-tested one.
      const result = await this.returns
        .createQueryBuilder()
        .update(ReturnOrmEntity)
        .set(
          match === undefined
            ? { internalOrderId, updatedAt: () => 'now()' }
            : {
                internalOrderId,
                matchedAt: match.at,
                matchedByUserId: match.actorUserId,
                updatedAt: () => 'now()',
              }
        )
        .where('"id" = :id', { id })
        .andWhere('"internalOrderId" IS NULL')
        .execute();

      return (result.affected ?? 0) > 0;
    } catch (error) {
      throw new ReturnPersistenceError('claimAttribution', error);
    }
  }

  async claimAuthorizedAt(id: string, at: Date): Promise<boolean> {
    // The `claimDeclinedAt` shape, and the same reasoning: `IsNull()` in the WHERE
    // is the at-most-once guarantee, not the ADR-044 proposal slot and not a lock.
    // Claim-only, no release — an authorization does not become untrue.
    const result = await this.returns.update({ id, authorizedAt: IsNull() }, { authorizedAt: at });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Set — or clear — ONE producer's OMS inert state on this return (#2352).
   *
   * The same statement `OrderRecordRepository.updateOmsAttention` runs, from the
   * one shared builder — see `buildAuthorityAttentionUpsertSql` for why each of
   * its clauses is load-bearing. Unlike {@link claimAttribution} this is
   * last-write-wins rather than first-write-wins: a claim records an irreversible
   * fact once, whereas a state report is re-decided and the newest answer is the
   * truthful one.
   */
  async updateOmsAttention<P extends AuthorityAttentionProducer>(
    id: string,
    producer: P,
    outcome: AuthorityAttentionOutcome<P>
  ): Promise<void> {
    if (outcome.kind === 'indeterminate') {
      return;
    }

    try {
      await this.returns.query(
        buildAuthorityAttentionUpsertSql({ table: 'returns', idColumn: 'id', alias: 'r' }),
        [
          id,
          producer,
          buildAuthorityAttentionPayload(producer, outcome.kind === 'blocked' ? outcome : null),
          new Date().toISOString(),
        ]
      );
    } catch (error) {
      throw new ReturnPersistenceError('updateOmsAttention', error);
    }
  }

  /**
   * The pass-2 candidate page (#2330) — headers projection, deterministic order.
   *
   * Built with the query builder rather than `find()` because two of the three
   * filters have no `FindOptions` spelling that stays honest: the terminal-status
   * exclusion is a `NOT IN` over a list that may legally be EMPTY (in which case
   * the clause must be OMITTED, not rendered as `NOT IN ()`, which is a syntax
   * error in Postgres and would take the whole sweep down for the adapters that
   * declare no vocabulary), and the age bound has to fall back from `openedAt`
   * to `createdAt` for a row whose source sent an unparseable timestamp — those
   * rows are real returns and must not become permanently invisible to the sweep
   * because of a formatting fault at the source.
   *
   * `externalReturnId IS NOT NULL` is not a nicety: a return with no source key
   * has nothing to re-read BY, so including it would guarantee a 404 every run.
   */
  async findForSourceSweep(
    filter: ReturnSourceSweepFilter,
    limit: number,
    offset: number
  ): Promise<ReturnSweepCandidate[]> {
    const rows = await this.buildSweepQuery(filter)
      .select(['r.id', 'r.externalReturnId', 'r.rawStatus'])
      .orderBy('COALESCE(r."openedAt", r."createdAt")', 'ASC')
      .addOrderBy('r.id', 'ASC')
      // `limit`/`offset`, not `take`/`skip`: the latter are entity-paging
      // helpers that switch to a subquery form, and this read is a raw
      // projection with no joins — the direct SQL clauses are what it means.
      .limit(limit)
      .offset(offset)
      .getRawMany<{ r_id: string; r_externalReturnId: string; r_rawStatus: string }>();

    return rows.map((row) => ({
      id: row.r_id,
      externalReturnId: row.r_externalReturnId,
      rawStatus: row.r_rawStatus,
    }));
  }

  async countForSourceSweep(filter: ReturnSourceSweepFilter): Promise<number> {
    return this.buildSweepQuery(filter).getCount();
  }

  async claimDeclinedAt(id: string, at: Date): Promise<boolean> {
    // Conditional write — `IsNull()` in the WHERE is what makes this atomic
    // under two concurrent triggers, so exactly one UPDATE can affect the row.
    // There is deliberately no release counterpart: a decline observed at the
    // source does not become untrue.
    const result = await this.returns.update({ id, declinedAt: IsNull() }, { declinedAt: at });
    return (result.affected ?? 0) > 0;
  }

  /**
   * The single WHERE the page read and the count read share.
   *
   * One builder, two callers — so a filter can never be applied to the page but
   * not the total, which would make the scan offset wrap against a set it is not
   * actually paging through and silently skip or repeat rows forever.
   */
  private buildSweepQuery(filter: ReturnSourceSweepFilter): SelectQueryBuilder<ReturnOrmEntity> {
    const query = this.returns
      .createQueryBuilder('r')
      .where('r."sourceConnectionId" = :connectionId', { connectionId: filter.sourceConnectionId })
      .andWhere('r."origin" = :origin', { origin: filter.origin })
      .andWhere('r."externalReturnId" IS NOT NULL')
      .andWhere('COALESCE(r."openedAt", r."createdAt") >= :openedSince', {
        openedSince: filter.openedSince,
      });

    if (filter.terminalRawStatuses.length > 0) {
      // Opaque set membership — core never interprets a member. Omitted
      // entirely when empty; `NOT IN ()` is a Postgres syntax error, and an
      // adapter that declares no terminal vocabulary must degrade to the age
      // bound rather than take the sweep down.
      query.andWhere('r."rawStatus" NOT IN (:...terminalRawStatuses)', {
        terminalRawStatuses: filter.terminalRawStatuses,
      });
    }

    return query;
  }

  private toDomain(
    header: ReturnOrmEntity,
    lines: ReturnLineOrmEntity[],
    counters: ReturnStageCounters | null = null,
    restockBlocked: boolean | null = null
  ): ReturnRecord {
    return new ReturnRecord(
      header.id,
      header.sourceConnectionId,
      header.externalReturnId,
      header.internalOrderId,
      header.externalOrderId,
      header.origin as ReturnOrigin,
      header.rawStatus,
      header.rawPayload,
      header.openedAt,
      header.authorizedAt,
      header.declinedAt,
      header.closedAt,
      header.createdAt,
      header.updatedAt,
      lines.map((line) => this.toLineDomain(line)),
      header.matchedAt,
      header.matchedByUserId,
      counters,
      restockBlocked,
      // Coerced at the mapping boundary, so an entry written by a newer release
      // and then rolled back is ABSENT from the domain record rather than
      // present-and-unrenderable (spec §4.4 S2-5).
      readAuthorityAttentionEntries(header.omsAttention)
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

  // ---------------------------------------------------------------------------
  // Custody writes and the act ledger (#2370)
  // ---------------------------------------------------------------------------

  async findLine(lineId: string): Promise<{ line: ReturnLine; record: ReturnRecord } | null> {
    const lineEntity = await this.lines.findOne({ where: { id: lineId } });
    if (lineEntity === null) {
      return null;
    }
    const record = await this.findById(lineEntity.returnId);
    if (record === null) {
      return null;
    }
    return { line: this.toLineDomain(lineEntity), record };
  }

  /**
   * See the port docblock for why the row lock is load-bearing rather than
   * defensive: the counter transitions are read-then-write, and the DB CHECK
   * cannot see a lost update.
   *
   * `seq` is allocated from `MAX(seq) + 1` INSIDE the same locked transaction,
   * which is what makes the `return:{returnId}:{lineId}:{seq}` idempotency key
   * safe to build afterwards — under the lock no peer can mint the same value,
   * and `UQ_return_line_events_line_seq` is the belt to that braces.
   */
  async runLineWrite<T>(
    lineId: string,
    write: (locked: {
      line: ReturnLine;
      record: ReturnRecord;
    }) => ReturnLineWriteDecision<T> | Promise<ReturnLineWriteDecision<T>>
  ): Promise<{ event: ReturnLineEvent; result: T }> {
    return this.dataSource.transaction(async (manager) => {
      const lineEntity = await manager
        .getRepository(ReturnLineOrmEntity)
        .createQueryBuilder('line')
        .setLock('pessimistic_write')
        .where('line.id = :lineId', { lineId })
        .getOne();

      if (lineEntity === null) {
        throw new ReturnLineNotFoundError(lineId);
      }

      const headerEntity = await manager
        .getRepository(ReturnOrmEntity)
        .findOne({ where: { id: lineEntity.returnId } });
      if (headerEntity === null) {
        throw new ReturnLineNotFoundError(lineId);
      }

      const record = this.toDomain(headerEntity, [lineEntity]);
      const decision = await write({ line: this.toLineDomain(lineEntity), record });

      const saved = await this.appendEvent(manager, decision.event);

      if (decision.outcome !== null) {
        await this.applyCustodyOutcome(manager, lineId, decision.outcome, decision.disposition);
      }

      return { event: saved, result: decision.result };
    });
  }

  async settleLineRestock(
    eventId: string,
    lineId: string,
    patch: SettleReturnLineEventInput,
    computeOutcome: (line: ReturnLine) => ReturnCustodyOutcome | null,
    disposition: ReturnDisposition | null
  ): Promise<ReturnLineEvent> {
    return this.dataSource.transaction(async (manager) => {
      // Lock the line and compute the move from the LOCKED row — see the port
      // docblock: an outcome carries absolute counters, so computing it from an
      // earlier unlocked read would clobber a concurrent receipt.
      const lineEntity = await manager
        .getRepository(ReturnLineOrmEntity)
        .createQueryBuilder('line')
        .setLock('pessimistic_write')
        .where('line.id = :lineId', { lineId })
        .getOne();

      if (lineEntity === null) {
        throw new ReturnLineNotFoundError(lineId);
      }

      const outcome = computeOutcome(this.toLineDomain(lineEntity));

      await manager.getRepository(ReturnLineEventOrmEntity).update(
        { id: eventId },
        {
          restockState: patch.restockState,
          restockBlockedReason: patch.restockBlockedReason,
          restockBlockedDetail: patch.restockBlockedDetail,
          restockedBy: patch.restockedBy,
          ...(patch.masterConnectionId !== undefined
            ? { masterConnectionId: patch.masterConnectionId }
            : {}),
        }
      );

      if (outcome !== null) {
        await this.applyCustodyOutcome(manager, lineId, outcome, disposition);
      }

      const settled = await manager
        .getRepository(ReturnLineEventOrmEntity)
        .findOne({ where: { id: eventId } });
      if (settled === null) {
        throw new ReturnPersistenceError(
          'settleLineRestock',
          new Error(`Return line event ${eventId} vanished while settling its restock outcome`)
        );
      }
      return this.toLineEventDomain(settled);
    });
  }

  async findOutstandingRestockEvents(lineId: string): Promise<ReturnLineEvent[]> {
    const rows = await this.lineEvents
      .createQueryBuilder('event')
      .where('event."returnLineId" = :lineId', { lineId })
      .andWhere(`event."restockState" IN ('blocked', 'in_doubt')`)
      .orderBy('event."seq"', 'ASC')
      .getMany();
    return rows.map((row) => this.toLineEventDomain(row));
  }

  async findOutstandingRestockEventsForReturn(returnId: string): Promise<ReturnLineEvent[]> {
    const rows = await this.lineEvents
      .createQueryBuilder('event')
      .where('event."returnId" = :returnId', { returnId })
      .andWhere(`event."restockState" IN ('blocked', 'in_doubt')`)
      .orderBy('event."returnLineId"', 'ASC')
      .addOrderBy('event."seq"', 'ASC')
      .getMany();
    return rows.map((row) => this.toLineEventDomain(row));
  }

  async findAttestationsForReturn(returnId: string): Promise<ReturnLineEvent[]> {
    const rows = await this.lineEvents
      .createQueryBuilder('event')
      .where('event."returnId" = :returnId', { returnId })
      .andWhere(`event."kind" = 'stock_attestation'`)
      .orderBy('event."returnLineId"', 'ASC')
      .addOrderBy('event."seq"', 'ASC')
      .getMany();
    return rows.map((row) => this.toLineEventDomain(row));
  }

  /**
   * See {@link ReturnRepositoryPort.findTimelineEntriesForOrder}.
   *
   * One query. `returns` is the driving table because every entry — custody
   * act included — needs its `origin` and `externalReturnId`, and a
   * `LEFT JOIN` is what lets a return with no acts yet still contribute its
   * `opened` entry rather than vanishing from the timeline.
   *
   * `getRawMany` rather than `getMany`: this projects a neutral shape and does
   * not want either entity materialised. It is also the shape that cannot
   * silently drop an `addSelect` column, which `getMany` does.
   */
  async findTimelineEntriesForOrder(internalOrderId: string): Promise<ReturnTimelineEntriesForOrder> {
    const rows = await this.returns
      .createQueryBuilder('r')
      .leftJoin(ReturnLineEventOrmEntity, 'ev', 'ev."returnId" = r.id')
      .select([
        'r."id" AS "returnId"',
        'r."sourceConnectionId" AS "sourceConnectionId"',
        'r."externalReturnId" AS "externalReturnId"',
        'r."origin" AS "origin"',
        'r."openedAt" AS "openedAt"',
        'r."declinedAt" AS "declinedAt"',
        'ev."id" AS "eventId"',
        'ev."kind" AS "kind"',
        'ev."quantity" AS "quantity"',
        'ev."restockState" AS "restockState"',
        'ev."disposition" AS "disposition"',
        'ev."actorUserId" AS "actorUserId"',
        'ev."occurredAt" AS "occurredAt"',
      ])
      .where('r."internalOrderId" = :internalOrderId', { internalOrderId })
      .orderBy('ev."occurredAt"', 'ASC')
      .getRawMany<{
        returnId: string;
        sourceConnectionId: string;
        externalReturnId: string | null;
        origin: string;
        openedAt: Date | null;
        declinedAt: Date | null;
        eventId: string | null;
        kind: string | null;
        quantity: number | null;
        restockState: string | null;
        disposition: string | null;
        actorUserId: string | null;
        occurredAt: Date | null;
      }>();

    const entries: ReturnTimelineEntry[] = [];
    const sourceConnectionIdByReturn = new Map<string, string>();
    const contexts = new Map<string, ReturnTimelineContext & { sourceConnectionId: string }>();
    // One `opened` / `declined` entry PER RETURN, not per joined row — the join
    // repeats the header columns once per act, and emitting them each time
    // would tell the operator a return was opened four times.
    const headersSeen = new Set<string>();

    for (const row of rows) {
      const origin = row.origin as ReturnOrigin;

      sourceConnectionIdByReturn.set(row.returnId, row.sourceConnectionId);
      contexts.set(row.returnId, {
        returnId: row.returnId,
        externalReturnId: row.externalReturnId,
        returnOrigin: origin,
        // Resolved by the service — a repository does not turn an id into a name.
        sourceConnectionName: null,
        sourceConnectionId: row.sourceConnectionId,
      });

      if (!headersSeen.has(row.returnId)) {
        headersSeen.add(row.returnId);
        for (const [kind, at] of [
          ['opened', row.openedAt],
          ['declined', row.declinedAt],
        ] as const) {
          if (at === null) continue;
          entries.push({
            id: `${row.returnId}:${kind}`,
            source: 'record_status',
            kind,
            occurredAt: at,
            returnId: row.returnId,
            externalReturnId: row.externalReturnId,
            returnOrigin: origin,
            sourceConnectionName: null,
            // A header column carries no actor: `opened` and `declined` are a
            // SOURCE claim or nothing, never a person.
            actorUserId: null,
            quantity: null,
            restockState: null,
            disposition: null,
            refundExecutedBy: null,
            amount: null,
            currency: null,
          });
        }
      }

      if (row.eventId === null || row.occurredAt === null || row.kind === null) continue;

      entries.push({
        id: row.eventId,
        source: 'custody_act',
        kind: row.kind,
        occurredAt: row.occurredAt,
        returnId: row.returnId,
        externalReturnId: row.externalReturnId,
        returnOrigin: origin,
        sourceConnectionName: null,
        actorUserId: row.actorUserId,
        quantity: row.quantity,
        restockState: row.restockState as ReturnRestockState | null,
        disposition: row.disposition,
        refundExecutedBy: null,
        amount: null,
        currency: null,
      });
    }

    return { entries, sourceConnectionIdByReturn, contexts: [...contexts.values()] };
  }

  async listLineEvents(lineId: string): Promise<ReturnLineEvent[]> {
    const rows = await this.lineEvents.find({
      where: { returnLineId: lineId },
      order: { seq: 'ASC' },
    });
    return rows.map((row) => this.toLineEventDomain(row));
  }

  /**
   * Claim every refundable line of a return for ONE attempt (#2371, ADR-056).
   *
   * A single conditional UPDATE — the `claimAttribution` shape — so two
   * concurrent attempts can never both claim the same line and a double refund
   * is impossible independently of the surrounding lock. `RETURNING "id"` is
   * what makes the claim usable: the caller settles exactly the rows it won,
   * never "the return's lines" re-read afterwards, which a peer could have
   * changed in between.
   *
   * `updatedAt` is set explicitly because a query-builder update bypasses
   * `@UpdateDateColumn` (the same note `claimAttribution` carries).
   */
  async claimRefundAttempt(
    returnId: string,
    targetState: Extract<ReturnMoneyState, 'in_doubt' | 'triggered'>,
    at: Date
  ): Promise<string[]> {
    try {
      const result = await this.lines
        .createQueryBuilder()
        .update(ReturnLineOrmEntity)
        // The caller's instant rather than `now()`: one attempt stamps one time
        // across every line it claims, so the rows it won are identifiable as a
        // single act rather than as N writes that happened to be adjacent.
        .set({ moneyState: targetState, updatedAt: at })
        .where('"returnId" = :returnId', { returnId })
        .andWhere('"moneyState" IN (:...attemptable)', {
          attemptable: [...REFUND_ATTEMPTABLE_MONEY_STATES],
        })
        .returning('"id"')
        .execute();

      const raw: unknown = result.raw;
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw
        .map((row) => (row as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string');
    } catch (error) {
      throw new ReturnPersistenceError('claimRefundAttempt', error);
    }
  }

  /**
   * Settle the lines an attempt claimed (#2371).
   *
   * Scoped BOTH to the claimed ids and to the caller's `fromStates`, which is
   * required rather than defaulted — see the port, where the two callers' guards
   * are opposite and a shared default would be silently wrong for one of them.
   * Returns the number of rows actually moved so a caller can notice a settle
   * that lost its race, rather than assuming it landed.
   */
  async settleRefundState(
    returnId: string,
    lineIds: readonly string[],
    moneyState: ReturnMoneyState,
    fromStates: readonly ReturnMoneyState[]
  ): Promise<number> {
    if (lineIds.length === 0 || fromStates.length === 0) {
      // An empty `fromStates` would render `IN ()` — a Postgres syntax error —
      // and means "move nothing" anyway (the #2330 `NOT IN ()` lesson).
      return 0;
    }
    try {
      const result = await this.lines
        .createQueryBuilder()
        .update(ReturnLineOrmEntity)
        .set({ moneyState, updatedAt: () => 'now()' })
        .where('"returnId" = :returnId', { returnId })
        .andWhere('"id" IN (:...lineIds)', { lineIds: [...lineIds] })
        .andWhere('"moneyState" IN (:...fromStates)', { fromStates: [...fromStates] })
        .execute();

      return result.affected ?? 0;
    } catch (error) {
      throw new ReturnPersistenceError('settleRefundState', error);
    }
  }

  /**
   * The money states on a return's lines, for naming a refusal (#2371). Read
   * only on the refusal path — see `claimRefundAttempt`.
   */
  async listLineMoneyStates(returnId: string): Promise<ReturnMoneyState[]> {
    const rows = await this.lines.find({
      where: { returnId },
      select: { moneyState: true },
    });
    return rows.map((row) => row.moneyState as ReturnMoneyState);
  }

  /**
   * Append one act, allocating its `seq` under the caller's already-locked
   * transaction. Never call this outside {@link ReturnRepository.runLineWrite}:
   * the `MAX(seq) + 1` read is only safe because the line row is locked.
   */
  private async appendEvent(
    manager: EntityManager,
    input: CreateReturnLineEventInput
  ): Promise<ReturnLineEvent> {
    const repo = manager.getRepository(ReturnLineEventOrmEntity);
    const highest = await repo
      .createQueryBuilder('event')
      .select('MAX(event."seq")', 'max')
      .where('event."returnLineId" = :lineId', { lineId: input.returnLineId })
      .getRawOne<{ max: number | string | null }>();

    const entity = new ReturnLineEventOrmEntity();
    entity.returnId = input.returnId;
    entity.returnLineId = input.returnLineId;
    entity.seq = Number(highest?.max ?? 0) + 1;
    entity.kind = input.kind;
    entity.quantity = input.quantity;
    entity.disposition = input.disposition;
    entity.restockState = input.restockState;
    entity.restockBlockedReason = input.restockBlockedReason;
    entity.restockBlockedDetail = input.restockBlockedDetail;
    entity.restockedBy = input.restockedBy;
    entity.masterConnectionId = input.masterConnectionId;
    entity.note = input.note;
    entity.actorUserId = input.actorUserId;
    entity.occurredAt = input.occurredAt;
    entity.attestedByEventId = input.attestedByEventId;

    const saved = await repo.save(entity);
    return this.toLineEventDomain(saved);
  }

  /**
   * Write the counters, the custody state and its two instants.
   *
   * `disposition` on `return_lines` is LAST-APPLIED-WINS and is a display
   * convenience only: a line can hold several disposition acts with different
   * dispositions, so the column cannot represent a mixed line and nothing
   * branches on it. The ledger and the counters are authoritative.
   */
  private async applyCustodyOutcome(
    manager: EntityManager,
    lineId: string,
    outcome: ReturnCustodyOutcome,
    disposition: ReturnDisposition | null
  ): Promise<void> {
    await manager.getRepository(ReturnLineOrmEntity).update(
      { id: lineId },
      {
        custodyState: outcome.custodyState,
        quantityReceived: outcome.quantityReceived,
        quantityRestocked: outcome.quantityRestocked,
        quantityScrapped: outcome.quantityScrapped,
        receivedAt: outcome.receivedAt,
        disposedAt: outcome.disposedAt,
        ...(disposition !== null ? { disposition } : {}),
      }
    );
  }

  private toLineEventDomain(entity: ReturnLineEventOrmEntity): ReturnLineEvent {
    return new ReturnLineEvent(
      entity.id,
      entity.returnId,
      entity.returnLineId,
      Number(entity.seq),
      this.toLineEventKind(entity.kind),
      Number(entity.quantity),
      entity.disposition as ReturnDisposition | null,
      entity.restockState as ReturnRestockState,
      entity.restockBlockedReason as ReturnRestockBlockReason | null,
      entity.restockBlockedDetail,
      entity.restockedBy as RestockedBy | null,
      entity.masterConnectionId,
      entity.note,
      entity.actorUserId,
      entity.occurredAt,
      entity.attestedByEventId,
      entity.createdAt
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
  /**
   * Fail-safe read of the stored `kind` column — a WARNING, not a coercion.
   *
   * Deliberately unlike {@link ReturnRepository.toRefundReason} one method
   * below, which degrades an unrecognised value to `'other'`. That works only
   * because `RefundReason` HAS an honest default; `ReturnLineEventKind` has
   * none, and `ReturnLineEvent.kind` is non-nullable, so there is no value this
   * method could substitute without either fabricating an act that did not
   * happen or widening the entity type. It therefore passes the stored string
   * through verbatim — which is not a lie, it IS what the row says — and
   * converts the previous silence into a signal.
   *
   * **The residue, stated so the trigger is legible rather than a judgement
   * call.** Pass-through means an unrecognised value reaches consumers TYPED as
   * a member of a union it is not a member of. That is tolerable only while
   * nothing branches on `kind` — today four producers, this one read, and zero
   * branches anywhere in the tree. The first `switch`, exhaustive `Record` or
   * conditional keyed on `kind` makes this cast load-bearing, and at that point
   * widening `ReturnLineEvent.kind` to admit an unrecognised value stops being
   * optional. Follow-up, not this issue.
   */
  private toLineEventKind(rawKind: string): ReturnLineEventKind {
    if (!(ReturnLineEventKindValues as readonly string[]).includes(rawKind)) {
      this.logger.warn(
        `Unrecognised return line event kind "${rawKind}" — this build does not know it; ` +
          'passing it through unchanged'
      );
    }
    return rawKind as ReturnLineEventKind;
  }

  private toRefundReason(rawReason: string): RefundReason {
    const narrowed = narrowRefundReason(rawReason);
    if (narrowed !== null) {
      return narrowed;
    }
    this.logger.warn(`Unrecognised return reason "${rawReason}" — falling back to "other"`);
    return 'other';
  }
}
