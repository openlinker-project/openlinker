/**
 * Invoice Numbering Series Repository
 *
 * TypeORM implementation of `InvoiceNumberingSeriesRepositoryPort` (#1575). Maps
 * ORM ↔ domain privately. The `allocateNumber` primitive is the fiscal heart: a
 * SINGLE atomic `UPDATE ... RETURNING` advances the sequence and resolves the
 * period reset inside the statement (no check-then-increment race), then the
 * rendered number is written onto the invoice record under a
 * `documentNumber IS NULL` guard — BOTH inside one transaction so a series is
 * never advanced without the number landing on the record (and vice versa).
 * Postgres unique-violations on the numbering guards surface as
 * `DuplicateDocumentNumberException`; a missing series/record as their
 * respective not-found domain errors.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/repositories
 * @implements {InvoiceNumberingSeriesRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { InvoiceNumberingSeries } from '../../../domain/entities/invoice-numbering-series.entity';
import { DuplicateDocumentNumberException } from '../../../domain/exceptions/duplicate-document-number.exception';
import { InvoiceNumberingSeriesNotFoundException } from '../../../domain/exceptions/invoice-numbering-series-not-found.exception';
import { InvoiceRecordNotFoundException } from '../../../domain/exceptions/invoice-record-not-found.exception';
import type { InvoiceNumberingSeriesRepositoryPort } from '../../../domain/ports/invoice-numbering-series-repository.port';
import { computePeriodKey, renderInvoiceNumber } from '../../../domain/numbering/invoice-number-pattern';
import type {
  AllocatedNumber,
  CreateInvoiceNumberingSeriesInput,
  SeriesAssignmentData,
  UpdateInvoiceNumberingSeriesInput,
} from '../../../domain/types/invoice-numbering.types';
import { InvoiceNumberingAssignmentOrmEntity } from '../entities/invoice-numbering-assignment.orm-entity';
import { InvoiceNumberingSeriesOrmEntity } from '../entities/invoice-numbering-series.orm-entity';
import { InvoiceRecordOrmEntity } from '../entities/invoice-record.orm-entity';

/** Shape of the atomic-allocation RETURNING row. */
interface AllocateRow {
  allocated_seq: number | string;
  pattern: string;
  seqPadding: number | string;
}

@Injectable()
export class InvoiceNumberingSeriesRepository implements InvoiceNumberingSeriesRepositoryPort {
  constructor(
    @InjectRepository(InvoiceNumberingSeriesOrmEntity)
    private readonly seriesRepo: Repository<InvoiceNumberingSeriesOrmEntity>,
    @InjectRepository(InvoiceNumberingAssignmentOrmEntity)
    private readonly assignmentRepo: Repository<InvoiceNumberingAssignmentOrmEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async createSeries(input: CreateInvoiceNumberingSeriesInput): Promise<InvoiceNumberingSeries> {
    const entity = this.seriesRepo.create({
      name: input.name,
      pattern: input.pattern,
      nextSeq: input.nextSeq,
      seqPadding: input.seqPadding,
      resetPolicy: input.resetPolicy,
      periodKey: input.periodKey,
    });
    const saved = await this.seriesRepo.save(entity);
    return this.toSeriesDomain(saved);
  }

  async findSeriesById(id: string): Promise<InvoiceNumberingSeries | null> {
    const entity = await this.seriesRepo.findOne({ where: { id } });
    return entity ? this.toSeriesDomain(entity) : null;
  }

  async listSeries(): Promise<InvoiceNumberingSeries[]> {
    const entities = await this.seriesRepo.find({ order: { createdAt: 'DESC' } });
    return entities.map((e) => this.toSeriesDomain(e));
  }

  async listUnassignedSeries(): Promise<InvoiceNumberingSeries[]> {
    const assignments = await this.assignmentRepo.find();
    const assigned = new Set<string>();
    for (const a of assignments) {
      assigned.add(a.mainSeriesId);
      if (a.correctionSeriesId) {
        assigned.add(a.correctionSeriesId);
      }
    }
    const all = await this.seriesRepo.find({ order: { createdAt: 'DESC' } });
    return all.filter((e) => !assigned.has(e.id)).map((e) => this.toSeriesDomain(e));
  }

  async updateSeries(
    id: string,
    patch: UpdateInvoiceNumberingSeriesInput,
  ): Promise<InvoiceNumberingSeries> {
    const entity = await this.seriesRepo.findOne({ where: { id } });
    if (!entity) {
      throw new InvoiceNumberingSeriesNotFoundException(id);
    }
    Object.assign(entity, patch);
    const saved = await this.seriesRepo.save(entity);
    return this.toSeriesDomain(saved);
  }

  async findAssignmentByConnectionId(
    connectionId: string,
  ): Promise<SeriesAssignmentData | null> {
    const entity = await this.assignmentRepo.findOne({ where: { connectionId } });
    return entity ? this.toAssignmentDomain(entity) : null;
  }

  async upsertAssignment(input: {
    connectionId: string;
    mainSeriesId: string;
    correctionSeriesId: string | null;
  }): Promise<SeriesAssignmentData> {
    const existing = await this.assignmentRepo.findOne({
      where: { connectionId: input.connectionId },
    });
    const entity =
      existing ??
      this.assignmentRepo.create({ connectionId: input.connectionId });
    entity.mainSeriesId = input.mainSeriesId;
    entity.correctionSeriesId = input.correctionSeriesId;
    const saved = await this.assignmentRepo.save(entity);
    return this.toAssignmentDomain(saved);
  }

  async allocateNumber(input: {
    seriesId: string;
    recordId: string;
    connectionId: string;
    issueDate: Date;
  }): Promise<AllocatedNumber> {
    // Precompute every candidate period key in TS (the pure helper is the single
    // source of truth for period-key formatting) and let one SQL statement pick
    // the right one by the row's own resetPolicy — so the reset is resolved
    // INSIDE the atomic UPDATE with no re-read of the row.
    const noneKey = computePeriodKey('none', input.issueDate);
    const yearlyKey = computePeriodKey('yearly', input.issueDate);
    const monthlyKey = computePeriodKey('monthly', input.issueDate);
    const quarterlyKey = computePeriodKey('quarterly', input.issueDate);

    return this.dataSource.transaction(async (manager) => {
      // Single guarded UPDATE ... RETURNING. SET expressions read the OLD row
      // (old periodKey / old nextSeq); RETURNING reads the NEW row. In BOTH
      // branches the allocated sequence equals (new nextSeq - 1):
      //   - reset:  new nextSeq = 2       → allocated 1
      //   - normal: new nextSeq = old + 1 → allocated old
      const rawResult = (await manager.query(
        `UPDATE "invoice_numbering_series"
         SET
           "nextSeq" = CASE
             WHEN "periodKey" IS DISTINCT FROM (
               CASE "resetPolicy"
                 WHEN 'none' THEN $2 WHEN 'yearly' THEN $3
                 WHEN 'monthly' THEN $4 WHEN 'quarterly' THEN $5 END)
             THEN 2 ELSE "nextSeq" + 1 END,
           "periodKey" = (
             CASE "resetPolicy"
               WHEN 'none' THEN $2 WHEN 'yearly' THEN $3
               WHEN 'monthly' THEN $4 WHEN 'quarterly' THEN $5 END),
           "updatedAt" = now()
         WHERE "id" = $1
         RETURNING ("nextSeq" - 1) AS allocated_seq, "pattern", "seqPadding"`,
        [input.seriesId, noneKey, yearlyKey, monthlyKey, quarterlyKey],
      )) as unknown;

      // TypeORM's `query()` returns `[rows, affectedCount]` for a data-modifying
      // statement with RETURNING; unwrap to the rows array either way.
      const rows: AllocateRow[] =
        Array.isArray(rawResult) && Array.isArray(rawResult[0])
          ? (rawResult[0] as AllocateRow[])
          : (rawResult as AllocateRow[]);
      const row = rows[0];
      if (!row) {
        throw new InvoiceNumberingSeriesNotFoundException(input.seriesId);
      }

      const allocatedSeq = Number(row.allocated_seq);
      const documentNumber = renderInvoiceNumber(row.pattern, {
        seq: allocatedSeq,
        seqPadding: Number(row.seqPadding),
        issueDate: input.issueDate,
      });

      // Persist the rendered number onto the record under a null-guard so a
      // re-run cannot double-allocate onto an already-numbered record. The
      // unique numbering indexes catch a re-rendered (rolled-back) number.
      try {
        const updateResult = await manager
          .createQueryBuilder()
          .update(InvoiceRecordOrmEntity)
          .set({ numberingSeriesId: input.seriesId, documentNumber })
          .where('id = :id', { id: input.recordId })
          .andWhere('"documentNumber" IS NULL')
          .execute();
        if (!updateResult.affected || updateResult.affected === 0) {
          // Either the record vanished or it was already numbered. Disambiguate.
          const exists = await manager.findOne(InvoiceRecordOrmEntity, {
            where: { id: input.recordId },
          });
          if (!exists) {
            throw new InvoiceRecordNotFoundException(input.recordId);
          }
          // Already numbered by a prior run — treat as idempotent and reuse it.
          return { documentNumber: exists.documentNumber ?? documentNumber, allocatedSeq };
        }
      } catch (error) {
        if (error instanceof QueryFailedError && error.message.includes('duplicate key')) {
          throw new DuplicateDocumentNumberException(input.connectionId, documentNumber);
        }
        throw error;
      }

      return { documentNumber, allocatedSeq };
    });
  }

  private toSeriesDomain(entity: InvoiceNumberingSeriesOrmEntity): InvoiceNumberingSeries {
    return new InvoiceNumberingSeries(
      entity.id,
      entity.name,
      entity.pattern,
      entity.nextSeq,
      entity.seqPadding,
      entity.resetPolicy,
      entity.periodKey,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  private toAssignmentDomain(
    entity: InvoiceNumberingAssignmentOrmEntity,
  ): SeriesAssignmentData {
    return {
      connectionId: entity.connectionId,
      mainSeriesId: entity.mainSeriesId,
      correctionSeriesId: entity.correctionSeriesId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
