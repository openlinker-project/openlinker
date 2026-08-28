/**
 * Order Provisioning Resume Service Interface (#2341)
 *
 * Closes the one gap #2339 stated and deliberately left open: releasing a hold
 * makes the next provisioning run succeed, but nothing ENQUEUES that run, and
 * for a cursor-based source journal (Allegro) the original order event will not
 * be re-delivered. Without this seam a released order simply sits
 * un-provisioned until something unrelated happens to re-poll it.
 *
 * ## Why it lives here and not on `IOrderHoldService`
 *
 * It needs `IIdentifierMappingService`, `JobEnqueuePort` and
 * `OrderRecordRepositoryPort`. `OrderHoldService` is provided by the LEAF
 * `OrderHoldsModule`, whose entire purpose (#2338 / #2339 docblocks) is that it
 * takes one repository and nothing else; injecting three more seams there drags
 * the eight-context `OrdersModule` graph into the leaf, and would make the
 * `released` lifecycle fact conditional on a job queue being reachable. It
 * belongs beside `OrderDestinationRetryService`, which already holds exactly
 * these dependencies — which is what #2339 meant by "#2341's release route sits
 * beside the job-enqueue seam".
 *
 * ## Four properties are load-bearing
 *
 * 1. **The release is the fact; the enqueue is a consequence.** The hold is
 *    already released and `releasedAt` already stamped when `resume` runs. A
 *    throw would answer 5xx for a release that DID happen, and the operator's
 *    retry would land on `HoldAlreadyReleasedError` (409) — the route reporting
 *    failure for its own success.
 * 2. **This service NEVER THROWS for a modelled condition.** That is the
 *    contract, and `order-provisioning-resume.service.spec.ts` asserts it. Every
 *    modelled failure leaves by the result union. The controller still wraps the
 *    call, but strictly as a last-resort guard for an UNMODELLED throw.
 * 3. **The failure arm carries a CODE, never the caught message.** An enqueue
 *    failure surfaces from Redis / Postgres / TypeORM, and those messages
 *    routinely carry a host, a port, sometimes a credential fragment — putting
 *    one in an HTTP response body breaches the "never return secrets in API
 *    responses" baseline, and the wording is not OL's to publish in any case.
 *    The underlying message is logged at `error` with the order id instead.
 * 4. **`skipped` is not `failed`.** An order with no source-external-id mapping
 *    has no source-side job to enqueue at all; reporting that as a failure would
 *    put a red state on a healthy order.
 * 5. **A `failed` resume leaves the order in the state the documented remedy
 *    actually recovers (#2588 review I-2).** Reporting the failure in a one-shot
 *    response is not enough on its own: the withheld destination rows are
 *    `pending`, `OrderDestinationRetryService` refuses anything that is not
 *    `failed`, and `pending` renders identically to healthy in-flight — so an
 *    operator who missed the toast had an order that read normal and never
 *    shipped, with no reachable remedy. The failure arm therefore also marks
 *    every still-withheld destination `failed`, which both unlocks the Retry
 *    action and makes the strand visible. That write is best-effort and never
 *    converts a modelled `failed` into a throw (property 2).
 *
 * The outcome is still RETURNED as well, because `marketplace.order.sync` has no
 * cron backstop for one specific order — a lost enqueue is an order that stays
 * un-provisioned until someone retries it. Returning it is what lets the
 * operator surface (#2342) point at the destination Retry action in the same
 * breath as the release, rather than leaving it to be discovered.
 *
 * @module libs/core/src/orders/application/interfaces
 * @see {@link OrderProvisioningResumeService} for the implementation
 */
import type { JobType } from '@openlinker/core/sync';

/**
 * Why no source-side job could be enqueued, for an order that is nonetheless
 * healthy. `as const` + union per `engineering-standards.md § Union Types`, so a
 * consumer can render it exhaustively.
 */
export const ProvisioningResumeSkipReasonValues = [
  'order-not-found',
  'missing-source-external-id',
] as const;

export type ProvisioningResumeSkipReason =
  (typeof ProvisioningResumeSkipReasonValues)[number];

export type OrderProvisioningResumeResult =
  | { status: 'enqueued'; jobId: string; jobType: JobType }
  | { status: 'skipped'; reason: ProvisioningResumeSkipReason }
  | { status: 'failed'; reason: 'enqueue-failed' };

export interface IOrderProvisioningResumeService {
  /**
   * Re-enqueue the source-side `marketplace.order.sync` for one order, so a
   * provisioning run suppressed by a hold happens now that the hold is gone.
   *
   * Writes nothing. `OrderDestinationRetryService` claims its slot by flipping a
   * destination row `failed -> pending`; #2339 already persists a held skip as
   * `pending` WITH the reason, so there is nothing to claim here and re-flipping
   * would erase that reason text.
   *
   * Never throws for a modelled condition — see property 2 above.
   */
  resume(internalOrderId: string): Promise<OrderProvisioningResumeResult>;
}
