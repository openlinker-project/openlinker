/**
 * Order Export Service (#3534, D35)
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderExportService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { OrderExportRepositoryPort } from '../../domain/ports/order-export-repository.port';
import type { OrderExportRun } from '../../domain/entities/order-export-run.entity';
import { ORDER_EXPORT_TTL_DAYS } from '../../domain/types/order-export.types';
import type {
  OrderExportFile,
  OrderExportFormat,
  OrderExportScope,
} from '../../domain/types/order-export.types';
import type { IOrderExportService } from './order-export.service.interface';
import { ORDER_EXPORT_REPOSITORY_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderExportService implements IOrderExportService {
  constructor(
    @Inject(ORDER_EXPORT_REPOSITORY_TOKEN)
    private readonly repository: OrderExportRepositoryPort
  ) {}

  async requestExport(input: {
    requestedByUserId: string;
    format: OrderExportFormat;
    scope: OrderExportScope;
    filters: Record<string, unknown>;
    selectedOrderIds: string[];
    columns: string[];
  }): Promise<OrderExportRun> {
    const expiresAt = new Date(Date.now() + ORDER_EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000);
    return this.repository.create(input, expiresAt);
  }

  async getRun(id: string): Promise<OrderExportRun | null> {
    return this.repository.findById(id);
  }

  async markReady(
    id: string,
    result: { rowCount: number; containsPii: boolean; file: OrderExportFile }
  ): Promise<boolean> {
    return this.repository.markReady(id, result);
  }

  async markFailed(id: string, errorMessage: string): Promise<boolean> {
    return this.repository.markFailed(id, errorMessage);
  }
}
