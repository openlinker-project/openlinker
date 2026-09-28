/**
 * Order Export Run Repository (#3534, D35)
 *
 * TypeORM implementation of `OrderExportRepositoryPort`. `markReady` /
 * `markFailed` are conditional UPDATEs guarded on `status = 'pending'` — the
 * `AnalyticsRemediationRunRepository.transitionIfOpen` shape — so a
 * re-delivered job cannot overwrite a result another attempt already wrote.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 */
import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderExportRunOrmEntity } from '../entities/order-export-run.orm-entity';
import { OrderExportRun } from '../../../domain/entities/order-export-run.entity';
import type { OrderExportRepositoryPort } from '../../../domain/ports/order-export-repository.port';
import type {
  CreateOrderExportRunInput,
  OrderExportFile,
  OrderExportFormat,
  OrderExportScope,
  OrderExportStatus,
} from '../../../domain/types/order-export.types';

const ORDER_EXPORT_ID_PREFIX = 'ol_order_export_';

@Injectable()
export class OrderExportRepository implements OrderExportRepositoryPort {
  constructor(
    @InjectRepository(OrderExportRunOrmEntity)
    private readonly repository: Repository<OrderExportRunOrmEntity>
  ) {}

  async create(input: CreateOrderExportRunInput, expiresAt: Date): Promise<OrderExportRun> {
    const entity = new OrderExportRunOrmEntity();
    entity.id = `${ORDER_EXPORT_ID_PREFIX}${randomUUID().replace(/-/g, '')}`;
    entity.requestedByUserId = input.requestedByUserId;
    entity.status = 'pending';
    entity.format = input.format;
    entity.scope = input.scope;
    entity.filters = input.filters;
    entity.selectedOrderIds = input.selectedOrderIds;
    entity.columns = input.columns;
    entity.rowCount = null;
    entity.containsPii = null;
    entity.errorMessage = null;
    entity.file = null;
    entity.expiresAt = expiresAt;
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<OrderExportRun | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async markReady(
    id: string,
    result: { rowCount: number; containsPii: boolean; file: OrderExportFile }
  ): Promise<boolean> {
    const updateResult = await this.repository.update(
      { id, status: 'pending' },
      {
        status: 'ready',
        rowCount: result.rowCount,
        containsPii: result.containsPii,
        file: result.file,
      }
    );
    return (updateResult.affected ?? 0) > 0;
  }

  async markFailed(id: string, errorMessage: string): Promise<boolean> {
    const updateResult = await this.repository.update(
      { id, status: 'pending' },
      { status: 'failed', errorMessage }
    );
    return (updateResult.affected ?? 0) > 0;
  }

  async purgeExpiredFiles(now: Date, limit: number): Promise<number> {
    // Postgres has no UPDATE ... LIMIT, so the batch is bounded via a
    // subquery selecting at most `limit` eligible ids first (the
    // `runBoundedSweep` precedent, applied to a DELETE-shaped write). Only
    // rows still carrying a non-null `file` are eligible, so a repeated
    // sweep over an already-cleared row costs nothing. `RETURNING "id"`
    // rather than trusting the driver's own affected-row reporting, whose
    // shape through `EntityManager.query()` is not worth depending on here.
    const cleared: { id: string }[] = await this.repository.manager.query(
      `UPDATE "order_exports"
          SET "file" = NULL
        WHERE "id" IN (
          SELECT "id" FROM "order_exports"
           WHERE "file" IS NOT NULL AND "expiresAt" <= $1
           ORDER BY "expiresAt" ASC
           LIMIT $2
        )
        RETURNING "id"`,
      [now, limit]
    );
    return cleared.length;
  }

  private toDomain(entity: OrderExportRunOrmEntity): OrderExportRun {
    return new OrderExportRun(
      entity.id,
      entity.requestedByUserId,
      this.toStatus(entity.status),
      entity.format as OrderExportFormat,
      entity.scope as OrderExportScope,
      entity.filters,
      entity.selectedOrderIds,
      entity.columns,
      entity.rowCount,
      entity.containsPii,
      entity.errorMessage,
      entity.file,
      entity.expiresAt,
      entity.createdAt,
      entity.updatedAt
    );
  }

  private toStatus(value: string): OrderExportStatus {
    if (value === 'pending' || value === 'ready' || value === 'failed') return value;
    // A status this build does not recognise (a future release wrote it) is
    // reported as `failed` rather than throwing — the `AnalyticsRemediationRunRepository`
    // reasoning: a caller reading a run must get SOME terminal-shaped answer,
    // never an uncaught exception on an ordinary read.
    return 'failed';
  }
}
