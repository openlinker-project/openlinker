/**
 * Sales-document batch run repository (#3583)
 *
 * TypeORM implementation of `SalesDocumentBatchRunRepositoryPort`.
 *
 * - `claim` is an INSERT guarded by `UQ_sales_document_batch_runs_running`; a
 *   unique violation on THAT index (matched by SQLSTATE and constraint name, so
 *   a primary-key collision is never misread as "already running") means
 *   another run holds the connection. A run left `running` past the stale bound
 *   is closed as `interrupted` first, or one dead worker would block the
 *   connection for ever.
 * - `finish` is a conditional UPDATE on `status = 'running'`.
 * - The queue read is over `order_records`, a same-context table, through its
 *   ORM entity (so a rename is a compile error, ADR-036's same-context rule).
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 */
import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { BatchRunSegment } from '@openlinker/core/sales-documents';
import {
  SalesDocumentBatchRun,
  SalesDocumentBatchRunItem,
} from '../../../domain/entities/sales-document-batch-run.entity';
import { readOrderLabel, type OrderLabel } from '../../../domain/order-label';
import type { SalesDocumentBatchRunRepositoryPort } from '../../../domain/ports/sales-document-batch-run-repository.port';
import {
  isBatchQueueB2b,
  type AppendSalesDocumentBatchRunItemInput,
  type CreateSalesDocumentBatchRunInput,
  type FinishSalesDocumentBatchRunInput,
  type SalesDocumentBatchQueueEntry,
  type SalesDocumentBatchQueueFilter,
  type SalesDocumentBatchRunFailureReason,
  type SalesDocumentBatchRunItemResult,
  type SalesDocumentBatchRunStatus,
  type SalesDocumentBatchRunTrigger,
} from '../../../domain/types/sales-document-batch-run.types';
import {
  SalesDocumentBatchRunItemOrmEntity,
  SalesDocumentBatchRunOrmEntity,
} from '../entities/sales-document-batch-run.orm-entity';
import { OrderRecordOrmEntity } from '../entities/order-record.orm-entity';

const RUN_ID_PREFIX = 'ol_sd_batch_';
const RUNNING_INDEX = 'UQ_sales_document_batch_runs_running';
const UNIQUE_VIOLATION = '23505';
const BATCHED_REASON = 'trigger-model-batched';

interface PgDriverError {
  code?: unknown;
  constraint?: unknown;
}

function isRunningIndexViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driver: unknown = (error as { driverError?: unknown }).driverError;
  if (typeof driver !== 'object' || driver === null) return false;
  const { code, constraint } = driver as PgDriverError;
  return code === UNIQUE_VIOLATION && constraint === RUNNING_INDEX;
}

@Injectable()
export class SalesDocumentBatchRunRepository implements SalesDocumentBatchRunRepositoryPort {
  constructor(
    @InjectRepository(SalesDocumentBatchRunOrmEntity)
    private readonly runs: Repository<SalesDocumentBatchRunOrmEntity>,
    @InjectRepository(SalesDocumentBatchRunItemOrmEntity)
    private readonly items: Repository<SalesDocumentBatchRunItemOrmEntity>,
    @InjectRepository(OrderRecordOrmEntity)
    private readonly orders: Repository<OrderRecordOrmEntity>,
  ) {}

  async claim(
    input: CreateSalesDocumentBatchRunInput,
    staleAfterMs: number,
  ): Promise<SalesDocumentBatchRun | null> {
    await this.runs.query(
      `UPDATE "sales_document_batch_runs"
          SET "status" = 'interrupted', "finishedAt" = now()
        WHERE "connectionId" = $1
          AND "status" = 'running'
          AND "startedAt" < now() - ($2 || ' milliseconds')::interval`,
      [input.connectionId, String(staleAfterMs)],
    );

    const entity = new SalesDocumentBatchRunOrmEntity();
    entity.id = `${RUN_ID_PREFIX}${randomUUID().replace(/-/g, '')}`;
    entity.connectionId = input.connectionId;
    entity.trigger = input.trigger;
    entity.documentKinds = [...input.documentKinds];
    entity.segment = input.segment;
    entity.slotAt = input.slotAt;
    entity.status = 'running';
    entity.failureReason = null;
    entity.eligibleCount = 0;
    entity.enqueuedCount = 0;
    entity.blockedCount = 0;
    entity.startedByUserId = input.startedByUserId;
    entity.startedAt = new Date();
    entity.finishedAt = null;
    try {
      await this.runs.insert(entity);
    } catch (error) {
      if (isRunningIndexViolation(error)) {
        return null;
      }
      throw error;
    }
    return this.toRun(entity);
  }

  async finish(runId: string, input: FinishSalesDocumentBatchRunInput): Promise<boolean> {
    const result = await this.runs.update(
      { id: runId, status: 'running' },
      {
        status: input.status,
        failureReason: input.failureReason,
        eligibleCount: input.eligibleCount,
        enqueuedCount: input.enqueuedCount,
        blockedCount: input.blockedCount,
        finishedAt: new Date(),
      },
    );
    return (result.affected ?? 0) > 0;
  }

  async appendItem(runId: string, input: AppendSalesDocumentBatchRunItemInput): Promise<void> {
    await this.items.insert({
      id: randomUUID(),
      runId,
      orderId: input.orderId,
      documentKind: input.documentKind,
      result: input.result,
      blockReason: input.blockReason,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async findById(runId: string): Promise<SalesDocumentBatchRun | null> {
    const entity = await this.runs.findOne({ where: { id: runId } });
    return entity ? this.toRun(entity) : null;
  }

  async findRunning(
    connectionId: string,
    staleAfterMs: number,
  ): Promise<SalesDocumentBatchRun | null> {
    // The same database clock and bound `claim` closes a stale run with, so a
    // row is never "stale" to one and "running" to the other.
    const entity = await this.runs
      .createQueryBuilder('run')
      .where('run.connectionId = :connectionId', { connectionId })
      .andWhere(`run.status = 'running'`)
      .andWhere(`run.startedAt >= now() - (:staleAfterMs || ' milliseconds')::interval`, {
        staleAfterMs: String(staleAfterMs),
      })
      .getOne();
    return entity ? this.toRun(entity) : null;
  }

  async listForConnection(
    connectionId: string,
    page: { limit: number; offset: number },
  ): Promise<{ runs: SalesDocumentBatchRun[]; total: number }> {
    const [entities, total] = await this.runs.findAndCount({
      where: { connectionId },
      order: { startedAt: 'DESC', id: 'DESC' },
      take: page.limit,
      skip: page.offset,
    });
    return { runs: entities.map((entity) => this.toRun(entity)), total };
  }

  async listItems(runId: string): Promise<SalesDocumentBatchRunItem[]> {
    const entities = await this.items.find({
      where: { runId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return entities.map(
      (entity) =>
        new SalesDocumentBatchRunItem(
          entity.id,
          entity.runId,
          entity.orderId,
          entity.documentKind,
          entity.result as SalesDocumentBatchRunItemResult,
          entity.blockReason,
          entity.idempotencyKey,
          entity.createdAt,
        ),
    );
  }

  async listQueue(filter: SalesDocumentBatchQueueFilter): Promise<SalesDocumentBatchQueueEntry[]> {
    const query = this.orders
      .createQueryBuilder('rec')
      .select([
        'rec.internalOrderId',
        'rec.sourceConnectionId',
        'rec.salesDocumentBlockDocumentKind',
        'rec.placedAt',
        'rec.totalAmount',
        'rec.currency',
        'rec.buyerTaxId',
        'rec.orderSnapshot',
      ])
      .where('rec.salesDocumentBlockReason = :reason', { reason: BATCHED_REASON })
      .andWhere('rec.salesDocumentBlockConnectionId = :connectionId', {
        connectionId: filter.connectionId,
      });

    if (filter.documentKinds !== undefined && filter.documentKinds.length > 0) {
      query.andWhere('rec.salesDocumentBlockDocumentKind IN (:...kinds)', {
        kinds: [...filter.documentKinds],
      });
    }
    // D42: B2B is an asserted tax id (a non-empty column); NULL (unknown) and
    // '' (asserted none) are both B2C. Mirrors `isBatchQueueB2b`.
    if (filter.segment === 'b2b') {
      query.andWhere(`rec.buyerTaxId IS NOT NULL AND rec.buyerTaxId <> ''`);
    } else if (filter.segment === 'b2c') {
      query.andWhere(`(rec.buyerTaxId IS NULL OR rec.buyerTaxId = '')`);
    }
    if (filter.afterOrderId !== undefined) {
      query.andWhere('rec.internalOrderId > :after', { after: filter.afterOrderId });
    }

    const rows = await query.orderBy('rec.internalOrderId', 'ASC').take(filter.limit).getMany();
    return rows.map((row) => ({
      orderId: row.internalOrderId,
      sourceConnectionId: row.sourceConnectionId,
      documentKind: row.salesDocumentBlockDocumentKind ?? '',
      placedAt: row.placedAt,
      totalAmount: row.totalAmount === null ? null : Number(row.totalAmount),
      currency: row.currency,
      isB2b: isBatchQueueB2b(row.buyerTaxId),
      ...readOrderLabel(row.orderSnapshot),
    }));
  }

  async listUntargetedBatched(page: {
    afterOrderId?: string;
    limit: number;
  }): Promise<string[]> {
    const query = this.orders
      .createQueryBuilder('rec')
      .select(['rec.internalOrderId'])
      .where('rec.salesDocumentBlockReason = :reason', { reason: BATCHED_REASON })
      .andWhere('rec.salesDocumentBlockConnectionId IS NULL');
    if (page.afterOrderId !== undefined) {
      query.andWhere('rec.internalOrderId > :after', { after: page.afterOrderId });
    }
    const rows = await query.orderBy('rec.internalOrderId', 'ASC').take(page.limit).getMany();
    return rows.map((row) => row.internalOrderId);
  }

  async findOrderLabels(orderIds: readonly string[]): Promise<Map<string, OrderLabel>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.orders
      .createQueryBuilder('rec')
      .select(['rec.internalOrderId', 'rec.orderSnapshot'])
      .where('rec.internalOrderId IN (:...ids)', { ids: [...orderIds] })
      .getMany();
    return new Map(rows.map((row) => [row.internalOrderId, readOrderLabel(row.orderSnapshot)]));
  }

  async countQueue(connectionId: string): Promise<Record<string, number>> {
    const rows: Array<{ kind: string | null; count: string }> = await this.orders
      .createQueryBuilder('rec')
      .select('rec.salesDocumentBlockDocumentKind', 'kind')
      .addSelect('COUNT(*)', 'count')
      .where('rec.salesDocumentBlockReason = :reason', { reason: BATCHED_REASON })
      .andWhere('rec.salesDocumentBlockConnectionId = :connectionId', { connectionId })
      .groupBy('rec.salesDocumentBlockDocumentKind')
      .getRawMany();
    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (row.kind !== null) counts[row.kind] = Number(row.count);
    }
    return counts;
  }

  private toRun(entity: SalesDocumentBatchRunOrmEntity): SalesDocumentBatchRun {
    return new SalesDocumentBatchRun(
      entity.id,
      entity.connectionId,
      entity.trigger as SalesDocumentBatchRunTrigger,
      entity.documentKinds,
      entity.segment as BatchRunSegment,
      entity.slotAt,
      entity.status as SalesDocumentBatchRunStatus,
      entity.failureReason as SalesDocumentBatchRunFailureReason | null,
      entity.eligibleCount,
      entity.enqueuedCount,
      entity.blockedCount,
      entity.startedByUserId,
      entity.startedAt,
      entity.finishedAt,
    );
  }
}
