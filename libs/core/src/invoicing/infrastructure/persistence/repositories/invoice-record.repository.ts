/**
 * Invoice Record Repository
 *
 * TypeORM implementation of `InvoiceRecordRepositoryPort`. Maps ORM ↔ domain
 * privately; callers receive domain entities only. Converts the Postgres
 * unique-violation on the dedup index into `DuplicateInvoiceRecordException`
 * (never leaks `QueryFailedError`), and throws `InvoiceRecordNotFoundException`
 * on the update path when the row is absent.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/repositories
 * @implements {InvoiceRecordRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { InvoiceRecord } from '../../../domain/entities/invoice-record.entity';
import { DuplicateInvoiceRecordException } from '../../../domain/exceptions/duplicate-invoice-record.exception';
import { InvoiceRecordNotFoundException } from '../../../domain/exceptions/invoice-record-not-found.exception';
import type { InvoiceRecordRepositoryPort } from '../../../domain/ports/invoice-record-repository.port';
import type {
  CreateInvoiceRecordInput,
  InvoiceOutcomePatch,
  InvoiceRecordFilters,
  InvoiceRecordPagination,
  PaginatedInvoiceRecords,
} from '../../../domain/types/invoicing.types';
import { TerminalRegulatoryStatusValues } from '../../../domain/types/invoicing.types';
import { InvoiceRecordOrmEntity } from '../entities/invoice-record.orm-entity';

@Injectable()
export class InvoiceRecordRepository implements InvoiceRecordRepositoryPort {
  constructor(
    @InjectRepository(InvoiceRecordOrmEntity)
    private readonly repository: Repository<InvoiceRecordOrmEntity>,
  ) {}

  async create(input: CreateInvoiceRecordInput): Promise<InvoiceRecord> {
    const entity = this.buildOrmEntity(input);
    try {
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.message.includes('duplicate key') &&
        input.idempotencyKey !== null
      ) {
        throw new DuplicateInvoiceRecordException(input.connectionId, input.idempotencyKey);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<InvoiceRecord | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByOrderId(orderId: string, connectionId: string): Promise<InvoiceRecord | null> {
    // (orderId, connectionId) is a NON-unique index: a keyless re-issue can leave
    // multiple rows for the same pair. Order newest-first so the single-row reads
    // (the AC-5 re-issue gate + GET /orders/:orderId/invoice) deterministically
    // see the LATEST attempt rather than an arbitrary duplicate.
    const entity = await this.repository.findOne({
      where: { orderId, connectionId },
      order: { createdAt: 'DESC' },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findLatestByOrderId(orderId: string): Promise<InvoiceRecord | null> {
    const entity = await this.repository.findOne({
      where: { orderId },
      // `id` is the tiebreaker so two records sharing a createdAt resolve deterministically.
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findByIdempotencyKey(
    connectionId: string,
    idempotencyKey: string,
  ): Promise<InvoiceRecord | null> {
    const entity = await this.repository.findOne({ where: { connectionId, idempotencyKey } });
    return entity ? this.toDomain(entity) : null;
  }

  async updateOutcome(id: string, patch: InvoiceOutcomePatch): Promise<InvoiceRecord> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new InvoiceRecordNotFoundException(id);
    }
    // sourceDocument is write-once (set at create). Guard against an untyped/cast
    // patch slipping the key through Object.assign and clobbering the snapshot.
    if ('sourceDocument' in patch) {
      throw new Error('sourceDocument is write-once and cannot be patched via updateOutcome');
    }
    Object.assign(entity, patch);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  /**
   * Atomic compare-and-swap claim of the in-flight issuance slot (#1200). A
   * SINGLE guarded UPDATE flips the row to `issuing` with a fresh lease ONLY when
   * no live attempt holds it — i.e. the row is `pending`/`failed`, OR it is
   * `issuing` with an EXPIRED lease. Postgres serialises the row-level write, so
   * of two concurrent same-key retries exactly one matches the WHERE and updates;
   * the loser's `affected` is 0 and it must back off WITHOUT a provider call.
   *
   * An `issued` row never matches (no `issued` in the allowed-status set), so a
   * terminal document is never re-claimed. Returns the claimed row on a win,
   * `null` on a loss; throws `InvoiceRecordNotFoundException` when the id is
   * absent (distinguished from a contended loss by a follow-up existence read).
   */
  async claimForIssue(id: string, leaseExpiresAt: Date): Promise<InvoiceRecord | null> {
    const now = new Date();
    const result = await this.repository
      .createQueryBuilder()
      .update(InvoiceRecordOrmEntity)
      .set({ status: 'issuing', leaseExpiresAt })
      .where('id = :id', { id })
      .andWhere(
        // Claimable iff NOT currently held by a live attempt and NOT terminal AND
        // NOT an in-doubt failure (a document may already exist — #1200). Defends
        // the fiscal invariant at the PERSISTENCE boundary, not just in the SVC:
        //   - pending (no lease by definition), OR
        //   - a TERMINAL-`rejected` failed row (definitely no document — safe), OR
        //   - issuing with an expired lease (a crashed prior attempt).
        // An `issued`, an in-doubt/mode-less `failed`, or a live `issuing` row
        // NEVER matches, so it can never be re-claimed and re-issued.
        `(status = 'pending'
          OR (status = 'failed' AND "failureMode" = 'rejected')
          OR (status = 'issuing' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= :now)))`,
        { now },
      )
      // Single statement: RETURNING hands back the just-claimed row in the SAME
      // write, so there is no UPDATE->read window in which another tx can mutate
      // the row out from under us (closes the won-but-stale-re-read race).
      .returning('*')
      .execute();

    if (result.affected && result.affected > 0) {
      const rawRows = (Array.isArray(result.raw) ? result.raw : []) as unknown[];
      const raw = rawRows[0] as Partial<InvoiceRecordOrmEntity> | undefined;
      if (raw) {
        // RETURNING gives the raw row shape; hydrate it through the repository's
        // entity metadata so the caller gets a fully-typed domain record.
        const entity = this.repository.create(raw);
        return this.toDomain(entity);
      }
      // We provably WON the claim (affected > 0) but could not read the row back
      // (e.g. a driver that does not honour RETURNING). This attempt now HOLDS the
      // lease, so it MUST NOT be reported as a contended loss (which would make the
      // holder back off and orphan the row). Re-read; if still unreadable, fail
      // loud rather than silently downgrade a win to a loss.
      const claimed = await this.repository.findOne({ where: { id } });
      if (claimed) {
        return this.toDomain(claimed);
      }
      throw new InvoiceRecordNotFoundException(id);
    }

    // No row updated: either the id does not exist, or the slot is held by a live
    // attempt / already terminal / an in-doubt failure. Disambiguate so the
    // contract can throw not-found vs. signal a contended-loss (`null`).
    const exists = await this.repository.findOne({ where: { id }, select: { id: true } });
    if (!exists) {
      throw new InvoiceRecordNotFoundException(id);
    }
    return null;
  }

  /**
   * Read-only AC-6 list (#1119). One `andWhere` per PRESENT filter only —
   * absent filters never constrain the query. The `issuedFrom`/`issuedTo`
   * bounds are inclusive and apply to `inv.issuedAt`. Ordered newest-first by
   * `createdAt` so the page is stable; `skip`/`take` carry the window.
   */
  async findMany(
    filter: InvoiceRecordFilters,
    pagination: InvoiceRecordPagination,
  ): Promise<PaginatedInvoiceRecords> {
    const qb = this.repository.createQueryBuilder('inv');

    if (filter.status !== undefined) {
      qb.andWhere('inv.status = :status', { status: filter.status });
    }
    if (filter.connectionId !== undefined) {
      qb.andWhere('inv.connectionId = :connectionId', { connectionId: filter.connectionId });
    }
    if (filter.regulatoryStatus !== undefined) {
      qb.andWhere('inv.regulatoryStatus = :regulatoryStatus', {
        regulatoryStatus: filter.regulatoryStatus,
      });
    }
    if (filter.issuedFrom !== undefined) {
      qb.andWhere('inv.issuedAt >= :issuedFrom', { issuedFrom: filter.issuedFrom });
    }
    if (filter.issuedTo !== undefined) {
      qb.andWhere('inv.issuedAt <= :issuedTo', { issuedTo: filter.issuedTo });
    }
    if (filter.taxId !== undefined) {
      qb.andWhere('inv.hasBuyerTaxId = :hasBuyerTaxId', {
        hasBuyerTaxId: filter.taxId === 'with',
      });
    }

    qb.orderBy('inv.createdAt', 'DESC').skip(pagination.offset).take(pagination.limit);

    const [entities, total] = await qb.getManyAndCount();
    return { items: entities.map((entity) => this.toDomain(entity)), total };
  }

  async findIssuedNonTerminal(
    connectionId: string,
    opts: { limit: number; cursor?: { updatedAt: Date; id: string } },
  ): Promise<{ items: InvoiceRecord[]; total: number }> {
    // Selection predicate (single source of truth in `TerminalRegulatoryStatusValues`,
    // mirrored by the `IDX_invoice_records_reconcile` partial index):
    //   status = 'issued' AND regulatoryStatus NOT IN (TerminalRegulatoryStatusValues)
    // Connection-scoped, ordered `updatedAt ASC, id ASC` (oldest-first, with a
    // fully deterministic `id` tie-break), capped at `opts.limit`. When a cursor
    // is supplied the page is the rows strictly AFTER it in `(updatedAt, id)`
    // order — KEYSET paging that lets the service walk the WHOLE non-terminal
    // frontier within one run even when the oldest rows never bump `updatedAt`
    // (#1121 plan decision #5, revised on #1206).
    //
    // Precision note: the column is Postgres `timestamp` (microsecond precision)
    // but the cursor `updatedAt` round-trips through a JS `Date` (millisecond
    // precision). Comparing/ordering on the raw column would let the cursor row's
    // truncated-millisecond value stay strictly less than its own microsecond
    // value, re-selecting the same row forever (the walk stalls on row 1). We
    // therefore truncate `updatedAt` to milliseconds on BOTH the keyset
    // comparison and the ORDER BY so the column's resolution matches the cursor's
    // — the `id` tie-break still yields a fully deterministic total order.
    const UPDATED_AT_MS = "date_trunc('milliseconds', record.updatedAt)";
    const baseWhere = (qb: ReturnType<typeof this.repository.createQueryBuilder>) =>
      qb
        .where('record.connectionId = :connectionId', { connectionId })
        .andWhere('record.status = :status', { status: 'issued' })
        .andWhere('record.regulatoryStatus NOT IN (:...terminal)', {
          terminal: [...TerminalRegulatoryStatusValues],
        });

    const pageQb = baseWhere(this.repository.createQueryBuilder('record'));
    if (opts.cursor) {
      // Row-value keyset comparison at millisecond resolution:
      // (trunc(updatedAt), id) > (cursor.updatedAt, cursor.id).
      pageQb.andWhere(
        `(${UPDATED_AT_MS}, record.id) > (:cursorUpdatedAt, :cursorId)`,
        { cursorUpdatedAt: opts.cursor.updatedAt, cursorId: opts.cursor.id },
      );
    }
    const entities = await pageQb
      .orderBy(UPDATED_AT_MS, 'ASC')
      .addOrderBy('record.id', 'ASC')
      .take(opts.limit)
      .getMany();

    // `total` is the FULL non-terminal count (cursor-independent) — coverage
    // logging only, never used for paging — so it stays stable across the
    // service's intra-run page walk.
    const total = await baseWhere(this.repository.createQueryBuilder('record')).getCount();

    return { items: entities.map((e) => this.toDomain(e)), total };
  }

  private buildOrmEntity(input: CreateInvoiceRecordInput): InvoiceRecordOrmEntity {
    const entity = new InvoiceRecordOrmEntity();
    entity.connectionId = input.connectionId;
    entity.orderId = input.orderId;
    entity.providerType = input.providerType;
    entity.documentType = input.documentType;
    entity.status = input.status;
    entity.idempotencyKey = input.idempotencyKey;
    entity.providerInvoiceId = input.providerInvoiceId ?? null;
    entity.providerInvoiceNumber = input.providerInvoiceNumber ?? null;
    entity.regulatoryStatus = input.regulatoryStatus ?? 'not-applicable';
    entity.clearanceReference = input.clearanceReference ?? null;
    entity.pdfUrl = input.pdfUrl ?? null;
    entity.issuedAt = input.issuedAt ?? null;
    entity.errorMessage = input.errorMessage ?? null;
    entity.failureMode = input.failureMode ?? null;
    entity.failureCode = input.failureCode ?? null;
    entity.failureReason = input.failureReason ?? null;
    // A freshly-created `pending` row holds no in-flight lease (#1200).
    entity.leaseExpiresAt = null;
    entity.hasBuyerTaxId = input.hasBuyerTaxId ?? false;
    entity.documentContent = input.documentContent ?? null;
    entity.sourceDocument = input.sourceDocument ?? null;
    return entity;
  }

  private toDomain(entity: InvoiceRecordOrmEntity): InvoiceRecord {
    return new InvoiceRecord(
      entity.id,
      entity.connectionId,
      entity.orderId,
      entity.providerType,
      entity.documentType,
      entity.status,
      entity.providerInvoiceId,
      entity.providerInvoiceNumber,
      entity.regulatoryStatus,
      entity.clearanceReference,
      entity.idempotencyKey,
      entity.pdfUrl,
      entity.issuedAt,
      entity.errorMessage,
      entity.createdAt,
      entity.updatedAt,
      entity.failureMode,
      entity.failureCode,
      entity.failureReason,
      entity.leaseExpiresAt,
      entity.hasBuyerTaxId,
      entity.documentContent,
      entity.sourceDocument,
    );
  }
}
