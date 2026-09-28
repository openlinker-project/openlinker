/**
 * Order Export Run Repository Port (#3534, D35)
 *
 * The write surface is narrow and append-then-terminalise: `create` inserts
 * a `pending` row, and `markReady`/`markFailed` move it ONCE to a terminal
 * status — the `analytics_remediation_runs` shape. There is no general
 * `save(run)`: a run row is evidence of what was requested and what was
 * generated, and evidence that can be freely rewritten is not evidence.
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { OrderExportRun } from '../entities/order-export-run.entity';
import type { CreateOrderExportRunInput, OrderExportFile } from '../types/order-export.types';

export interface OrderExportRepositoryPort {
  create(input: CreateOrderExportRunInput, expiresAt: Date): Promise<OrderExportRun>;

  findById(id: string): Promise<OrderExportRun | null>;

  /**
   * Move a `pending` run to `ready`, attaching the generated file. Returns
   * `false` when the run was not `pending` (a re-delivered job on an
   * already-terminal run) — conditional so a retried job cannot clobber a
   * result another attempt already wrote.
   */
  markReady(
    id: string,
    result: { rowCount: number; containsPii: boolean; file: OrderExportFile }
  ): Promise<boolean>;

  /** Move a `pending` run to `failed`. Same conditional-write shape as `markReady`. */
  markFailed(id: string, errorMessage: string): Promise<boolean>;
}
