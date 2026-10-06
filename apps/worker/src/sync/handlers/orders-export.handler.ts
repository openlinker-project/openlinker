/**
 * Orders Export Handler (#3534, D35, mockup M5)
 *
 * The `orders.export` driver: reads the run's scope/filters/columns, loads
 * the matching orders, builds the file, and writes it onto the run row.
 *
 * ONE SHOT, deliberately not paged/resumable like `analytics.currency.recalculate`
 * — an export is a read-then-write over a BOUNDED result set (`ORDER_EXPORT_ROW_CAP`),
 * not an unbounded per-order repair, so there is no cursor to carry across
 * reschedules. A run past the cap fails with a named reason rather than
 * silently truncating (ADR-007: a deterministic business refusal ends
 * immediately, no retries).
 *
 * PII is resolved ONCE per run, from `OL_STORE_PII` at GENERATION time —
 * never assumed by the frontend, which cannot read the install's env
 * (#3534's own "Backend gaps" note). `getEnvBoolean('OL_STORE_PII', true)`
 * rather than `getPiiConfig()`, the `fulfillment.work.dispatch` handler's
 * precedent: the latter throws whenever `OL_PII_HASH_SALT` is unset
 * regardless of the flag, which would fail every export on an install that
 * never set a salt.
 *
 * The resolved flag is also threaded into the row-projection layer
 * (`buildOrderExportCsv`/`buildOrderExportXlsx` → `resolveOrderExportCell`),
 * which blanks every PII column unconditionally when it is off — a
 * PII-storage flip is not retroactive, so an already-ingested row's
 * `orderSnapshot` may still carry a buyer's real name/email from a time
 * when the flag was on, and the file must never surface it just because the
 * database still does. `containsPii` on the run row reports what the FILE
 * actually carries, not merely the flag.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import { getEnvBoolean } from '@openlinker/shared/config';
import { Logger } from '@openlinker/shared/logging';
import {
  ORDER_EXPORT_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  narrowOrderExportColumns,
  buildOrderExportCsv,
  ORDER_EXPORT_DEFAULT_COLUMNS,
  ORDER_EXPORT_PII_COLUMNS,

  IOrderExportService,
  IOrderRecordService} from '@openlinker/core/orders';
import type {
  OrderExportColumnId,
  OrderRecordFilters,
} from '@openlinker/core/orders';
import {
  SyncJobExecutionError,
  type SyncJob as SyncJobEntity,
  type SyncJobHandler,
  type SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { buildOrderExportXlsx } from '../lib/order-export-xlsx';

type SyncJob = SyncJobEntity;

/**
 * Above this many rows the job refuses rather than truncates. Chosen well
 * under Excel's 1,048,576-row ceiling (#3534's own note) and generous for
 * the pilot's scale — a bounded ceiling with a named, actionable refusal
 * beats a job that runs for an unbounded time with no progress signal.
 */
const ORDER_EXPORT_ROW_CAP = 50_000;

interface OrdersExportPayloadV1 {
  schemaVersion: 1;
  runId: string;
}

@Injectable()
export class OrdersExportHandler implements SyncJobHandler {
  private readonly logger = new Logger(OrdersExportHandler.name);

  constructor(
    @Inject(ORDER_EXPORT_SERVICE_TOKEN)
    private readonly exports: IOrderExportService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const run = await this.exports.getRun(payload.runId);

    if (!run) {
      this.logger.warn(`orders.export: run ${payload.runId} no longer exists; nothing to generate`);
      return { outcome: 'business_failure' };
    }
    if (run.status !== 'pending') {
      this.logger.log(`orders.export: run ${payload.runId} is already ${run.status}; no-op`);
      return { outcome: 'ok' };
    }

    try {
      const orders =
        run.scope === 'selected'
          ? await this.orderRecords.findByIds(run.selectedOrderIds)
          : (
              await this.orderRecords.findMany(run.filters as OrderRecordFilters, {
                limit: ORDER_EXPORT_ROW_CAP + 1,
                offset: 0,
              })
            ).items;

      if (orders.length > ORDER_EXPORT_ROW_CAP) {
        await this.exports.markFailed(
          run.id,
          `The selection carries more than ${ORDER_EXPORT_ROW_CAP} orders; narrow the filters or export in smaller batches.`
        );
        return { outcome: 'business_failure' };
      }

      const storePii = getEnvBoolean('OL_STORE_PII', true);
      const requestedColumns = narrowOrderExportColumns(run.columns);
      const columns: OrderExportColumnId[] =
        requestedColumns.length > 0 ? requestedColumns : [...ORDER_EXPORT_DEFAULT_COLUMNS];

      const file =
        run.format === 'xlsx'
          ? {
              contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              contentBase64: (
                await buildOrderExportXlsx(orders, columns, storePii)
              ).toString('base64'),
              filename: this.filename(run.id, 'xlsx'),
            }
          : {
              contentType: 'text/csv; charset=utf-8',
              contentBase64: Buffer.from(
                buildOrderExportCsv(orders, columns, storePii),
                'utf-8'
              ).toString('base64'),
              filename: this.filename(run.id, 'csv'),
            };

      // Derived from what was actually WRITTEN, not merely the flag: a
      // column set carrying no PII column reports `false` even with
      // `storePii` on, and `storePii` off always reports `false` since
      // `resolveOrderExportCell` blanks every PII column unconditionally
      // (see that function's docblock — a stored snapshot may still carry
      // real PII from a time when `OL_STORE_PII` was on, so the flag alone
      // cannot answer "does this FILE carry PII").
      const containsPii =
        storePii && columns.some((c) => (ORDER_EXPORT_PII_COLUMNS as readonly string[]).includes(c));

      await this.exports.markReady(run.id, {
        rowCount: orders.length,
        containsPii,
        file,
      });
      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error generating the export';
      this.logger.error(`orders.export: run ${payload.runId} failed to generate: ${message}`);
      await this.exports.markFailed(run.id, message);
      // Reported via the run row, not the retry ladder: a generation failure
      // over an already-fixed dataset is very unlikely to succeed on retry,
      // and the operator's remedy (Jobs & Logs) reads the run's own message.
      return { outcome: 'business_failure' };
    }
  }

  private filename(runId: string, ext: 'csv' | 'xlsx'): string {
    const date = new Date().toISOString().slice(0, 10);
    return `orders-export-${date}-${runId.slice(-8)}.${ext}`;
  }

  private getPayload(job: SyncJob): OrdersExportPayloadV1 {
    const payload = job.payload as Partial<OrdersExportPayloadV1> | undefined;
    if (
      payload == null ||
      typeof payload !== 'object' ||
      payload.schemaVersion !== 1 ||
      typeof payload.runId !== 'string' ||
      payload.runId === ''
    ) {
      throw new SyncJobExecutionError(
        'Invalid orders.export payload: expected schemaVersion=1 and a non-empty runId',
        job.id,
        job.jobType,
        job.connectionId
      );
    }
    return { schemaVersion: 1, runId: payload.runId };
  }
}

export type { OrdersExportPayloadV1 };
