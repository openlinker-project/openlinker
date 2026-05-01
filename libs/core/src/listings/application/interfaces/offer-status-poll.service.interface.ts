/**
 * Offer Status Poll Service Interface
 *
 * Contract for the core orchestration step that follows up on an offer create
 * which Allegro accepted but has not finished validating
 * (`publication.status: ACTIVATING` → `CreateOfferResultStatus: 'validating'`).
 *
 * Two entry points:
 *   - `scheduleFirstPoll` — called from `OfferCreationExecutionService` after
 *     a create returns `'validating'`. Enqueues iteration #1.
 *   - `pollOnce` — called from the `marketplace.offer.pollCreationStatus`
 *     worker handler on each iteration. Reads marketplace state via
 *     `OfferStatusReader`, maps to `OfferCreationStatus`, persists, and either
 *     terminates or re-enqueues iteration `N+1`.
 *
 * Per `architecture-overview.md` §6, the polling-cadence policy (delays,
 * caps, terminal-state mapping) lives here in core — the worker handler is a
 * thin shell that just forwards the payload.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  PollOnceInput,
  PollOnceResult,
  ScheduleFirstPollInput,
} from '../types/offer-status-poll.types';

export interface IOfferStatusPollService {
  /**
   * Enqueue the first poll iteration. Idempotent on `recordId` — repeated
   * calls (e.g. operator-driven retry that mints a fresh record + so a fresh
   * recordId, or a worker retry of the create-flow) are deduped by the
   * iteration-keyed idempotency key.
   *
   * Failures of the underlying enqueue are logged and rethrown — caller
   * (`OfferCreationExecutionService`) decides whether to swallow.
   */
  scheduleFirstPoll(input: ScheduleFirstPollInput): Promise<void>;

  /**
   * Run a single poll iteration: hit the marketplace, map to record state,
   * persist, and either return terminal or schedule the next iteration.
   *
   * Exception model:
   *   - `OfferPollNotSupportedException` (adapter without `OfferStatusReader`)
   *     → caught here, written to record as `failed`/`OFFER_POLL_NOT_SUPPORTED`,
   *     returns `business_failure`.
   *   - `OfferNotFoundOnMarketplaceException` (adapter 404) → caught here,
   *     written to record as `failed`/`OFFER_NOT_FOUND`, returns `business_failure`.
   *   - Transient HTTP / network errors propagate so the runner's
   *     `maxAttempts=3` retry kicks in.
   */
  pollOnce(input: PollOnceInput): Promise<PollOnceResult>;
}
