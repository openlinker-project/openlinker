/**
 * Sales Document Attempt Keys (#3960)
 *
 * The exactly-once key a document attempt is held under, when a provider
 * refused an earlier attempt and the operator asks for the document again.
 *
 * Each attempt is its own record under its own key. Reusing the refused
 * attempt's key does not work: a provider that keeps one document per key, or
 * per token derived from the key, answers the retry with the document it
 * already refused. A fresh key is a
 * fresh document at the provider, which is safe precisely because a REFUSED
 * attempt created nothing there (ADR-042 decision 6, ADR-026 decision 4).
 *
 * Attempt 0 is the bare root key, byte-identical to every key written before
 * attempts existed, so no existing record, job or provider token changes.
 *
 * It lives in `sales-documents` because both document kinds follow one rule: a
 * fiscal receipt is not an invoice, so neither context could own it for the
 * other.
 *
 * @module libs/core/src/sales-documents/domain/types
 */

const ATTEMPT_SUFFIX = /:r(\d+)$/;

/**
 * The key attempt `attempt` of a document is held under.
 *
 * `attempt` is 0-based: the first attempt is the root key itself, the second is
 * `{root}:r1`, the third `{root}:r2`.
 */
export function withAttemptSuffix(rootKey: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError(`Document attempt must be a non-negative integer, got ${attempt}`);
  }
  return attempt === 0 ? rootKey : `${rootKey}:r${attempt}`;
}

/**
 * The root key an attempt key was derived from.
 *
 * Strips the suffix only when `attempt` says one is there. Reading the suffix
 * off the key alone would mistake a caller-chosen key that happens to end in
 * `:r7` for a seventh attempt.
 */
export function attemptRootKey(key: string, attempt: number): string {
  return attempt > 0 ? key.replace(ATTEMPT_SUFFIX, '') : key;
}

/**
 * What asking for a document again did (#3960).
 *
 * - `new-attempt`: a new attempt was started and will reach the provider.
 * - `joined`: an attempt was already queued or running; this request joined it.
 * - `redriven`: a previous attempt's job had given up and was restarted.
 * - `resumed`: an unfinished attempt had no live job; a new job picks it up
 *   under the same key.
 *
 * A request that would do nothing at all is refused instead of answering any of
 * these.
 */
export const DocumentRequestOutcomeValues = ['new-attempt', 'joined', 'redriven', 'resumed'] as const;
export type DocumentRequestOutcome = (typeof DocumentRequestOutcomeValues)[number];
