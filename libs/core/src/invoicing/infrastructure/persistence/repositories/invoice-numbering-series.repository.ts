/**
 * Invoice Numbering Series Repository
 *
 * TypeORM implementation of `InvoiceNumberingSeriesRepositoryPort` (#1575, #9,
 * #10). Maps ORM ↔ domain privately. The `allocateNumber` primitive is the
 * fiscal heart: a SINGLE atomic `UPDATE ... RETURNING` advances the sequence and
 * resolves the period reset inside the statement (no check-then-increment race),
 * then the rendered number is written onto the invoice record under a
 * `documentNumber IS NULL` guard — BOTH inside one transaction so a series is
 * never advanced without the number landing on the record (and vice versa). The
 * date variables + period key resolve from the document issue date in the
 * seller's timezone (#7); the rendered number is length-checked against the
 * provider limit (#11) before it is persisted. Postgres unique-violations on the
 * numbering guards surface as `DuplicateDocumentNumberException`; a missing
 * series/record as their respective not-found domain errors.
 *
 * Document-type routing (#9 / #10) replaces the pre-#9 main/correction
 * assignment: a connection's document resolves to a series by
 * `(connectionId, documentType, register)`, falling back to the register-less
 * default route for that type.
 *
 * @module libs/core/src/invoicing/infrastructure/persistence/repositories
 * @implements {InvoiceNumberingSeriesRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import type { FindOptionsWhere } from 'typeorm';

import { InvoiceNumberingSeries } from '../../../domain/entities/invoice-numbering-series.entity';
import { DuplicateDocumentNumberException } from '../../../domain/exceptions/duplicate-document-number.exception';
import { InvoiceNumberingSeriesNotFoundException } from '../../../domain/exceptions/invoice-numbering-series-not-found.exception';
import { InvoiceRecordNotFoundException } from '../../../domain/exceptions/invoice-record-not-found.exception';
import type { InvoiceNumberingSeriesRepositoryPort } from '../../../domain/ports/invoice-numbering-series-repository.port';
import {
  assertDocumentNumberWithinLength,
  computePeriodKey,
  renderInvoiceNumber,
} from '../../../domain/numbering/invoice-number-pattern';
import type {
  AllocatedNumber,
  CreateInvoiceNumberingSeriesInput,
  SeriesRouteData,
  UpdateInvoiceNumberingSeriesInput,
  UpsertSeriesRouteInput,
} from '../../../domain/types/invoice-numbering.types';
import { InvoiceNumberingRouteOrmEntity } from '../entities/invoice-numbering-route.orm-entity';
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
    @InjectRepository(InvoiceNumberingRouteOrmEntity)
    private readonly routeRepo: Repository<InvoiceNumberingRouteOrmEntity>,
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
      documentType: input.documentType,
      register: input.register,
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
    // #13: single LEFT JOIN — series with no referencing route are "unassigned".
    // Replaces the load-all-and-diff-in-TS implementation.
    const entities = await this.seriesRepo
      .createQueryBuilder('series')
      .leftJoin(
        InvoiceNumberingRouteOrmEntity,
        'route',
        'route."seriesId" = series.id',
      )
      .where('route.id IS NULL')
      .orderBy('series.createdAt', 'DESC')
      .getMany();
    return entities.map((e) => this.toSeriesDomain(e));
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

  async findSeriesIdForDocument(
    connectionId: string,
    documentType: string,
    register: string | null,
  ): Promise<string | null> {
    // Precedence: exact (register) route, then the register-less default route.
    if (register !== null) {
      const exact = await this.routeRepo.findOne({
        where: this.routeKey(connectionId, documentType, register),
      });
      if (exact) {
        return exact.seriesId;
      }
    }
    const fallback = await this.routeRepo.findOne({
      where: this.routeKey(connectionId, documentType, null),
    });
    return fallback ? fallback.seriesId : null;
  }

  /**
   * Build the `(connectionId, documentType, register)` where-clause. A `null`
   * register maps to `IsNull()` — TypeORM's `FindOptionsWhere` does not accept a
   * bare `null` for a nullable string column.
   */
  private routeKey(
    connectionId: string,
    documentType: string,
    register: string | null,
  ): FindOptionsWhere<InvoiceNumberingRouteOrmEntity> {
    return {
      connectionId,
      documentType,
      register: register === null ? IsNull() : register,
    };
  }

  async findRoutesByConnectionId(connectionId: string): Promise<SeriesRouteData[]> {
    const routes = await this.routeRepo.find({
      where: { connectionId },
      order: { documentType: 'ASC', createdAt: 'ASC' },
    });
    return routes.map((r) => this.toRouteDomain(r));
  }

  async upsertRoute(input: UpsertSeriesRouteInput): Promise<SeriesRouteData> {
    const register = input.register ?? null;
    const existing = await this.routeRepo.findOne({
      where: this.routeKey(input.connectionId, input.documentType, register),
    });
    const entity =
      existing ??
      this.routeRepo.create({
        connectionId: input.connectionId,
        documentType: input.documentType,
        register,
      });
    entity.seriesId = input.seriesId;
    const saved = await this.routeRepo.save(entity);
    return this.toRouteDomain(saved);
  }

  async deleteRoute(
    connectionId: string,
    documentType: string,
    register: string | null,
  ): Promise<void> {
    // Delete only the route pointer; the referenced series is never
    // cascade-deleted (detachable-pointer guarantee). No-op when absent.
    await this.routeRepo.delete(this.routeKey(connectionId, documentType, register));
  }

  async allocateNumber(input: {
    seriesId: string;
    recordId: string;
    connectionId: string;
    issueDate: Date;
    timeZone: string;
    maxDocumentNumberLength?: number;
  }): Promise<AllocatedNumber> {
    // Precompute every candidate period key in TS (the pure helper is the single
    // source of truth for period-key formatting) and let one SQL statement pick
    // the right one by the row's own resetPolicy — so the reset is resolved
    // INSIDE the atomic UPDATE with no re-read of the row. Every key resolves in
    // the seller timezone (#7) so the reset bucket matches the seller's calendar.
    const noneKey = computePeriodKey('none', input.issueDate, input.timeZone);
    const yearlyKey = computePeriodKey('yearly', input.issueDate, input.timeZone);
    const monthlyKey = computePeriodKey('monthly', input.issueDate, input.timeZone);
    const quarterlyKey = computePeriodKey('quarterly', input.issueDate, input.timeZone);

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
        timeZone: input.timeZone,
      });
      // #11: reject an over-length rendered number in OpenLinker (inside the
      // transaction, so the series advance rolls back) rather than at the provider.
      assertDocumentNumberWithinLength(documentNumber, input.maxDocumentNumberLength);

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
      entity.documentType,
      entity.register,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  private toRouteDomain(entity: InvoiceNumberingRouteOrmEntity): SeriesRouteData {
    return {
      connectionId: entity.connectionId,
      documentType: entity.documentType,
      register: entity.register,
      seriesId: entity.seriesId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
