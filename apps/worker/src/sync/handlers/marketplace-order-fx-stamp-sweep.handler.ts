/**
 * Marketplace Order FX Stamp Sweep Handler (#2125, ADR-040)
 *
 * Thin delegate for jobs of type `marketplace.order.fxStampSweep`, scheduled
 * hourly per `OrderSource`-capable connection - the reconcile guarantee that
 * survives a DEAD retry job. `createIfNotExistsByIdempotencyKey` returns the
 * existing row whatever its status and keys are globally unique with no TTL, so
 * once the ~4.3 h retry window is exhausted the `fx:{orderId}` key can never be
 * re-enqueued; a longer provider outage would otherwise lose the stamp
 * permanently. Reading the unstamped rows directly is also the only mechanism
 * that covers a retry job that was never enqueued at all.
 *
 * Delegates to the core `IOrderFxStampService.sweep`, which owns the predicate
 * (`reportingCurrency IS NULL` AND the row is either unanswered or carries a
 * terminal marker older than `terminalRetryBefore`) and re-enters the very same
 * per-order `stamp` the inline and retry paths use. The terminal arm is the only
 * recovery route out of a terminal answer whose cause has since cleared - a
 * throttled provider, a host booted without `FxIntegrationModule` (#2135 review,
 * finding 1).
 *
 * Always `outcome: 'ok'` on a completed tick: individual orders carry their own
 * terminal/deferred answers, and a tick that answered nothing is not a business
 * failure of the sweep. Only a failure of the sweep ITSELF (the bounded page
 * read) escapes as a retryable throw.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  MarketplaceOrderFxStampSweepPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { IOrderFxStampService } from '@openlinker/core/orders';
import { ORDER_FX_STAMP_SERVICE_TOKEN } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

/** Fallback page size when the scheduler descriptor omits `limit`. */
const DEFAULT_LIMIT = 100;
/** Upper bound on the page size, regardless of payload. */
const MAX_LIMIT = 500;
/**
 * Fallback age cutoff. 30 days comfortably covers any realistic provider outage
 * plus an operator's reaction time, while keeping a pre-feature backlog from
 * crowding out live orders on every tick.
 */
const DEFAULT_MAX_AGE_DAYS = 30;
const MAX_AGE_DAYS_CEILING = 365;
/**
 * How long a TERMINAL answer is honoured before the sweep gives the order one
 * more attempt (#2135 review, finding 1).
 *
 * Seven days sits between the two failure modes it has to separate. Shorter and
 * a genuinely unstampable order (an unsupported pair that will never be
 * supported) is re-answered often enough to cost real provider calls; longer and
 * a cleared condition - a host booted without `FxIntegrationModule`, a throttled
 * provider - keeps the order figureless well past the point an operator would
 * have fixed it. Only rows that still carry NO figure are re-admitted, so this
 * can never re-cross a stamped order.
 */
const DEFAULT_TERMINAL_RETRY_DAYS = 7;
const TERMINAL_RETRY_DAYS_CEILING = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class MarketplaceOrderFxStampSweepHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOrderFxStampSweepHandler.name);

  constructor(
    @Inject(ORDER_FX_STAMP_SERVICE_TOKEN)
    private readonly fxStamp: IOrderFxStampService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.getPayload(job);
    const now = Date.now();
    const createdSince = new Date(now - payload.maxAgeDays * MS_PER_DAY);
    const terminalRetryBefore = new Date(
      now - (payload.terminalRetryDays ?? DEFAULT_TERMINAL_RETRY_DAYS) * MS_PER_DAY
    );

    this.logger.debug(
      `Executing marketplace.order.fxStampSweep job ${job.id} for connection ${job.connectionId} ` +
        `(limit=${payload.limit}, createdSince=${createdSince.toISOString()}, ` +
        `terminalRetryBefore=${terminalRetryBefore.toISOString()})`
    );

    try {
      const result = await this.fxStamp.sweep(job.connectionId, {
        limit: payload.limit,
        createdSince,
        terminalRetryBefore,
      });

      if (result.scanned > 0) {
        this.logger.log(
          `FX stamp sweep (connection=${job.connectionId}): scanned=${result.scanned}, ` +
            `stamped=${result.stamped}, terminal=${result.terminal}, deferred=${result.deferred}`
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `Order FX stamp sweep failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOrderFxStampSweepPayloadV1 {
    const payload = job.payload as Partial<MarketplaceOrderFxStampSweepPayloadV1> | undefined;

    if (payload === null || typeof payload !== 'object' || payload.schemaVersion !== 1) {
      throw new SyncJobExecutionError(
        `Invalid marketplace.order.fxStampSweep payload: expected an object with schemaVersion=1`,
        job.id,
        job.jobType,
        job.connectionId
      );
    }

    // Default an absent / non-positive value, then clamp — a payload-supplied
    // bound can never widen the scan past the ceiling.
    const limit = Math.min(
      typeof payload.limit === 'number' && payload.limit > 0 ? payload.limit : DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const maxAgeDays = Math.min(
      typeof payload.maxAgeDays === 'number' && payload.maxAgeDays > 0
        ? payload.maxAgeDays
        : DEFAULT_MAX_AGE_DAYS,
      MAX_AGE_DAYS_CEILING
    );
    const terminalRetryDays = Math.min(
      typeof payload.terminalRetryDays === 'number' && payload.terminalRetryDays > 0
        ? payload.terminalRetryDays
        : DEFAULT_TERMINAL_RETRY_DAYS,
      TERMINAL_RETRY_DAYS_CEILING
    );

    return { schemaVersion: 1, limit, maxAgeDays, terminalRetryDays };
  }
}
