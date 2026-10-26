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

  /**
   * Physically clear the stored `file` blob on every run whose `expiresAt`
   * has already passed (#3534 recovery pass — the 7-day TTL was previously
   * enforced only as a download-time refusal, never a real deletion). The
   * ROW survives as a lightweight audit record (requester, row count,
   * format, timestamps); only the base64 bytes are cleared — this is what
   * "physically deletes expired export BLOBS" means here, as opposed to
   * deleting the run's own audit trail.
   *
   * Bounded to `limit` rows per call so a caller can budget a sweep across
   * several batches (the `runBoundedSweep` precedent applied to a DELETE
   * rather than an enqueue) instead of holding one unbounded UPDATE against
   * a table every export write also contends for. Only rows that still
   * carry a non-null `file` are touched, so a repeated sweep over an
   * already-cleared row is a cheap no-op rather than a wasted write.
   *
   * @returns the number of rows cleared in this call.
   */
  purgeExpiredFiles(now: Date, limit: number): Promise<number>;
}
