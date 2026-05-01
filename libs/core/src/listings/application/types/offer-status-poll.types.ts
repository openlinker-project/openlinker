/**
 * Offer Status Poll Types
 *
 * Input/output shapes for `OfferStatusPollService` (#447). Kept separate from
 * the service interface per the engineering-standards type-separation rule.
 *
 * @module libs/core/src/listings/application/types
 */

import type { JobOutcome } from '@openlinker/core/sync';

export interface ScheduleFirstPollInput {
  /** OL `OfferCreationRecord.id` whose `'validating'` status we'll be polling. */
  offerCreationRecordId: string;
  /** Marketplace-native offer id (e.g. Allegro `7781562863`). */
  externalOfferId: string;
  /** Connection that owns the offer. */
  connectionId: string;
}

export interface PollOnceInput {
  /** Same record id threaded through the payload chain. */
  offerCreationRecordId: string;
  /** Same external offer id. */
  externalOfferId: string;
  /** Owning connection. */
  connectionId: string;
  /**
   * 1-indexed polling-cadence counter. The handler reads this from the job
   * payload and forwards it; the service decides whether to terminate, write
   * the timeout, or schedule iteration `pollAttempt + 1`.
   */
  pollAttempt: number;
}

export interface PollOnceResult {
  /**
   * The handler passes this straight back to the runner via
   * `SyncJobHandlerResult` — kept identical to `JobOutcome` so no translation
   * happens between core and the worker shell.
   */
  outcome: JobOutcome;
}

/**
 * Cadence config snapshot. Read once on service construction from
 * `OL_ALLEGRO_OFFER_POLL_*` env vars; immutable per process lifetime.
 *
 * Defaults: 5s initial, 2× backoff, 60s cap, 12 max attempts → ~9 min worst
 * case. The Allegro adapter is currently the only consumer, hence the
 * env-var prefix; rename to `OL_OFFER_POLL_*` if a second marketplace ships
 * its own status reader.
 */
export interface OfferPollCadenceConfig {
  initialDelaySeconds: number;
  backoffMultiplier: number;
  maxDelaySeconds: number;
  maxAttempts: number;
}
