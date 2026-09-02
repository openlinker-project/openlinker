/**
 * Fulfilment-action refusal reader (#2411)
 *
 * The action endpoint answers 409 for two materially different facts, and the
 * client MUST act on them differently (#2406):
 *
 *   - `version_conflict` — the token was stale; somebody moved this task first.
 *     **Retryable** once the surface has re-read.
 *   - `action_not_legal` — the token was current; the state refused. Re-sending
 *     the identical request fails identically, so it is **surfaced, not
 *     retried**.
 *
 * Before #2406 gave them a `code`, the only way to tell them apart was sniffing
 * for the presence of `currentVersion` in the body. Reading the `code` is the
 * whole point; this module is the one place that reads it.
 *
 * ## Two further 409s carry no `code` at all
 *
 * `FulfillmentHoldLimitExceededError` and `FulfillmentHoldAlreadyReleasedError`
 * map to a plain `ConflictException(message)`. The hold-limit one is reachable
 * from this panel's own primary action, so an unrecognised 409 must surface the
 * SERVER'S message rather than a generic sentence — "could not do that" over
 * "this task already has the maximum number of holds" is a strictly worse
 * answer to a question the server already answered.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import { ApiError } from '../../../shared/api/api-error';

export interface FulfillmentConflict {
  /** `true` only for `version_conflict`. */
  retryable: boolean;
  /** Operator-facing sentence. */
  message: string;
  /**
   * The refreshed action set the server sent back, when it sent one. Reported
   * for completeness; the surface re-reads rather than patching its cache from
   * a partial body (`frontend-architecture.md § Async UX Conventions` — explicit
   * invalidation over clever cache mutation).
   */
  supportedActions: string[] | null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((entry): entry is string => typeof entry === 'string');
  return strings.length === value.length ? strings : null;
}

/**
 * Classify a failed action.
 *
 * Returns `null` for anything that is not a 409 — the caller then falls through
 * to its ordinary error handling. A 409 whose `code` this build does not
 * recognise is reported as NOT retryable and carries the server's own message:
 * treating an unknown refusal as retryable would loop a request the server has
 * already refused twice.
 */
export function readFulfillmentConflict(error: unknown): FulfillmentConflict | null {
  if (!(error instanceof ApiError) || !error.isConflict()) return null;

  const details = readRecord(error.details);
  const code = details?.['code'];
  const supportedActions = readStringArray(details?.['supportedActions']);

  if (code === 'version_conflict') {
    return {
      retryable: true,
      message:
        'Somebody moved this fulfilment task while you were looking at it. It has been refreshed — ' +
        'check it and try again.',
      supportedActions,
    };
  }

  if (code === 'action_not_legal') {
    return {
      retryable: false,
      message:
        'That is no longer possible for this fulfilment task. The available actions have been ' +
        'refreshed.',
      supportedActions,
    };
  }

  // An un-coded 409 (hold limit reached, hold already released) — the server's
  // message is the specific one, so it is used verbatim rather than replaced.
  return { retryable: false, message: error.message, supportedActions };
}

/**
 * Operator sentence for a failed action that is NOT one of the two coded 409s.
 *
 * A 400 gets the server's message: this endpoint's 400s name the problem
 * precisely — an action this build offered but the API does not execute, or an
 * action invoked without a field it needs — and both are things an operator can
 * report or an engineer can act on. A generic sentence would throw that away.
 */
export function describeFulfillmentActionError(error: unknown, fallback: string): string {
  const conflict = readFulfillmentConflict(error);
  if (conflict) return conflict.message;
  if (error instanceof ApiError && error.status === 400 && error.message.length > 0) {
    return error.message;
  }
  if (error instanceof ApiError && error.isForbidden()) {
    return 'You do not have permission to change fulfilment tasks.';
  }
  if (error instanceof ApiError && error.isNotFound()) {
    return 'This fulfilment task no longer exists.';
  }
  return fallback;
}
