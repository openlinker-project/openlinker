/**
 * Order Change Vocabulary Error
 *
 * Raised when a stored `order_changes` row carries a `kind` or `status` this
 * build does not recognise, so the row cannot be coerced onto the domain
 * entity.
 *
 * It is a DOMAIN error rather than a bare `Error` because the condition is a
 * real, anticipated one — Wave 2 widens `kind`, and a rollback then leaves rows
 * written by a newer build behind (`docs/engineering-standards.md §
 * Repository Error Handling`). A Wave-2 caller wanting to skip such a row needs
 * to discriminate it from every other read failure; with a bare `Error` its
 * only options are matching a message or surfacing a 500.
 *
 * NOT retryable: the stored value does not change on a re-run. The fix is a
 * forward deploy or a data correction.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderChangeVocabularyError extends Error {
  constructor(
    public readonly orderChangeId: string,
    /** Which vocabulary failed to coerce. */
    public readonly field: 'kind' | 'status',
    /** The unrecognised value, verbatim, so it can be quoted in a report. */
    public readonly value: string
  ) {
    super(
      `order_changes row ${orderChangeId} carries an unrecognised ${field} "${value}"`
    );
    this.name = 'OrderChangeVocabularyError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderChangeVocabularyError);
    }
  }
}
