/**
 * Offer Status Poll Types
 *
 * Input/output shapes for `OfferStatusPollService` (#447). Kept separate from
 * the service interface per the engineering-standards type-separation rule.
 *
 * Also holds the pure cadence rules for `OfferPollCadenceConfig` (resolution,
 * per-iteration delay, worst-case budget) under the pure-rule exception for
 * `*.types.ts`: both the poller and the status sync read them, so the budget
 * the guard is sized from is the budget the poller actually runs.
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
 * `OL_ALLEGRO_OFFER_POLL_*` env vars via `resolveOfferPollCadence`; immutable
 * per process lifetime.
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

/**
 * Resolve the creation poller's cadence from configuration, defaulting any key
 * that is not set.
 *
 * The one place the `OL_ALLEGRO_OFFER_POLL_*` keys are read: the poller paces
 * itself with the result, and the status sync sizes its "not found means
 * ended" guard from the same result, so a budget an operator lengthens moves
 * both together instead of leaving the guard sized for the old budget.
 */
export function resolveOfferPollCadence(
  read: (key: string) => number | undefined
): OfferPollCadenceConfig {
  return {
    initialDelaySeconds: read('OL_ALLEGRO_OFFER_POLL_INITIAL_DELAY_SECONDS') ?? 5,
    backoffMultiplier: read('OL_ALLEGRO_OFFER_POLL_BACKOFF_MULTIPLIER') ?? 2,
    maxDelaySeconds: read('OL_ALLEGRO_OFFER_POLL_MAX_DELAY_SECONDS') ?? 60,
    maxAttempts: read('OL_ALLEGRO_OFFER_POLL_MAX_ATTEMPTS') ?? 12,
  };
}

/**
 * Delay before poll iteration `pollAttempt` (1-indexed):
 * `initialDelay x multiplier^(attempt-1)`, clamped to `maxDelay`.
 */
export function offerPollDelaySeconds(cadence: OfferPollCadenceConfig, pollAttempt: number): number {
  const raw = cadence.initialDelaySeconds * Math.pow(cadence.backoffMultiplier, pollAttempt - 1);
  return Math.min(raw, cadence.maxDelaySeconds);
}

/**
 * The longest the poller can follow one freshly-created offer before it gives
 * up: every iteration's delay summed across `maxAttempts`. About 9 minutes at
 * the defaults (5 + 10 + 20 + 40 + 8 x 60 seconds).
 */
export function offerPollWorstCaseMs(cadence: OfferPollCadenceConfig): number {
  let totalSeconds = 0;
  for (let attempt = 1; attempt <= cadence.maxAttempts; attempt += 1) {
    totalSeconds += offerPollDelaySeconds(cadence, attempt);
  }
  return totalSeconds * 1000;
}
