/**
 * Order Export Service Interface (#3534, D35)
 *
 * @module libs/core/src/orders/application/services
 */
import type { OrderExportRun } from '../../domain/entities/order-export-run.entity';
import type {
  OrderExportFile,
  OrderExportFormat,
  OrderExportScope,
} from '../../domain/types/order-export.types';

export interface IOrderExportService {
  /** Opens a `pending` run. The caller (the controller) enqueues the driver job. */
  requestExport(input: {
    requestedByUserId: string;
    format: OrderExportFormat;
    scope: OrderExportScope;
    filters: Record<string, unknown>;
    selectedOrderIds: string[];
    columns: string[];
  }): Promise<OrderExportRun>;

  getRun(id: string): Promise<OrderExportRun | null>;

  markReady(
    id: string,
    result: { rowCount: number; containsPii: boolean; file: OrderExportFile }
  ): Promise<boolean>;

  markFailed(id: string, errorMessage: string): Promise<boolean>;
}
