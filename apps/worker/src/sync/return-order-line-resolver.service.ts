/**
 * Return order-line resolver (#3171)
 *
 * The worker-side composition that joins a freshly-ingested return to the order
 * lines it came from, so `ReturnLine.resolvedOrderLineId` carries the
 * `orderSnapshot.items[].id` the rest of the platform already keys on.
 *
 * **Why the worker and not `returns`.** The rule and the write both live in
 * core; only the ORDER READ lives here. `libs/core/src/returns` would otherwise
 * have to inject an orders service, and `OrdersModule` imports fourteen modules
 * — nine of them new to returns — for one `getOrderRecord` call. The repository
 * has solved this exact shape twice and chose the worker both times:
 * `OrderHoldsModule` exists as a leaf precisely "so `OrderHoldService` … can
 * take it WITHOUT the eight-context graph above", and #2712 reports its verdict
 * from core and has the worker write it through `IOrderRecordService`, adding
 * zero entries to the cross-context guard allow-sets. This adds zero too.
 *
 * Best-effort by construction: every failure is swallowed and logged. The join
 * is an attribution improvement, and failing a return-sync job over it would
 * trade a missing field for a lost return — the return itself is already
 * durably persisted by the time this runs.
 *
 * @module apps/worker/src/sync
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import {
  RETURNS_SERVICE_TOKEN,
  type IReturnsService,
  type ReturnOrderLineResolutionSummary,
} from '@openlinker/core/returns';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class ReturnOrderLineResolverService {
  private readonly logger = new Logger(ReturnOrderLineResolverService.name);

  constructor(
    @Inject(RETURNS_SERVICE_TOKEN)
    private readonly returns: IReturnsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService
  ) {}

  /**
   * Resolve every line of one return, and report what happened.
   *
   * Idempotent: core's write is a fill-in-when-NULL claim, so re-running this
   * for a return whose lines already resolved changes nothing and reports
   * `alreadyResolved`. That is what makes it safe to call from both the
   * per-return sync and the lifecycle re-read — and it is the only way a return
   * ingested BEFORE this shipped ever gets its lines resolved.
   *
   * Returns the summary rather than `void` so a future caller (or a future
   * revision of this one) can act on `unresolved` without re-reading — it costs
   * nothing to compute and was already being discarded. `null` means the pass
   * did not run at all (unknown return, an orphan, or an unreadable order),
   * distinct from a summary reporting zero resolutions.
   *
   * **`unresolved` is deliberately log-only in this slice.** An `ambiguous`
   * line (most commonly two order lines of the same offer at the same price,
   * `offerId+price`) is real and reachable — it is exactly the duplicate-line
   * case the credit-note picker exists for — and today it surfaces only in
   * this `warn` line. Threading it to an operator-visible count or metric is a
   * follow-up, not part of resolving the field correctly.
   */
  async resolveForReturn(returnId: string): Promise<ReturnOrderLineResolutionSummary | null> {
    try {
      const record = await this.returns.getReturn(returnId);
      if (record === null) {
        return null;
      }

      // An orphan has no order to resolve against. Not a failure: #2332's
      // reconcile attributes it later, and this runs again on the next re-read.
      if (record.internalOrderId === null) {
        return null;
      }

      const order = await this.orderRecords.getOrderRecord(record.internalOrderId);
      if (order === null) {
        this.logger.warn(
          `Return ${returnId} names order ${record.internalOrderId}, which could not be read — order lines not resolved`
        );
        return null;
      }

      // `OrderRecord.orderItems` is the owning context's own narrowing of the
      // snapshot, so the jsonb layout is not re-parsed here. It is structurally
      // assignable to `ResolvableOrderLine[]`. `[]` here means "no USABLE
      // lines" (a malformed snapshot filtered every one out), never "the
      // order has none" — surfaced so that distinction is observable rather
      // than only documented on `orderItems` itself.
      if (order.orderItems.length === 0) {
        this.logger.warn(
          `Return ${returnId} names order ${record.internalOrderId}, whose snapshot yielded no usable order lines — order lines not resolved`
        );
        return null;
      }

      const summary = await this.returns.resolveOrderLinesForReturn(returnId, order.orderItems);

      const unresolved = Object.entries(summary.unresolved);
      if (unresolved.length > 0) {
        // Reported, never defaulted. An unresolved line keeps `null` and the
        // correction path keeps its existing behaviour for it.
        this.logger.warn(
          `Return ${returnId}: ${summary.resolved} line(s) resolved to an order line, ` +
            `${summary.alreadyResolved} already resolved, unresolved — ` +
            unresolved.map(([reason, count]) => `${reason}=${count}`).join(', ')
        );
        return summary;
      }

      if (summary.resolved > 0) {
        this.logger.log(
          `Return ${returnId}: ${summary.resolved} line(s) resolved to an order line`
        );
      }

      return summary;
    } catch (error) {
      // Best-effort: the return is already persisted, and an attribution
      // failure must not fail the job that persisted it.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to resolve order lines for return ${returnId}: ${message}`);
      return null;
    }
  }
}
