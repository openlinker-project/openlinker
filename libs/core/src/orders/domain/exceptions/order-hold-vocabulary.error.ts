/**
 * Order Hold Vocabulary Error (#2338)
 *
 * Raised when a stored `order_holds` row carries a `reason` this build does not
 * recognise, so the row cannot be coerced onto the domain entity. The
 * `OrderChangeVocabularyError` shape, one table over.
 *
 * **It is reported rather than defaulted, and that is the whole reason it
 * exists.** `isHoldReason` deliberately has no fallback: silently mapping an
 * unrecognised value onto `operator` would attribute a machine's hold to a
 * human, which is worse than failing the read. `reason` is stored as a plain
 * `varchar` with no DB `CHECK` (see the migration's docblock), so a rollback
 * past a widened vocabulary is the realistic way to reach this.
 *
 * NOT retryable: the stored value does not change on a re-run. The fix is a
 * forward deploy or a data correction.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderHoldVocabularyError extends Error {
  constructor(
    public readonly holdId: string,
    /** The unrecognised value, verbatim, so it can be quoted in a report. */
    public readonly value: string
  ) {
    super(
      `order_holds row ${holdId} carries an unrecognised reason "${value}"`
    );
    this.name = 'OrderHoldVocabularyError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderHoldVocabularyError);
    }
  }
}
