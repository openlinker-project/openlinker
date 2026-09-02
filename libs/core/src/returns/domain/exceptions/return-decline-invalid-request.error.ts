/**
 * Return Decline Invalid Request Error (#2333, ADR-060 / ADR-044)
 *
 * OL's OWN pre-flight validation refused the decline: the operator-supplied
 * `reasonCode` is not in the source's vocabulary, or a field the source makes
 * conditionally mandatory is missing. Raised by the adapter — only the adapter
 * knows the vocabulary — but BEFORE any request leaves the process.
 *
 * **Distinct from `ReturnDeclineRejectedBySourceError` on purpose.** That one
 * means "the authority refused", and its reason is persisted verbatim into
 * `order_changes.declinedReason`, a column documented as *why the AUTHORITY
 * refused OL's request, never why OL asked*. Routing a local validation fault
 * there would attribute OL's own message to the marketplace, and would cost a
 * full open-then-decline cycle for something knowable up front.
 *
 * **Non-retryable**, and the fix is the operator's: correct the field and ask
 * again. The proposal opened for the attempt is abandoned (expired, never
 * declined) so the corrected retry is not blocked behind a TTL.
 *
 * @module libs/core/src/returns/domain/exceptions
 */
export class ReturnDeclineInvalidRequestError extends Error {
  constructor(
    /** The source-native return id the request was aimed at. */
    public readonly externalReturnId: string,
    /** Which field failed, in the neutral vocabulary the caller supplied. */
    public readonly field: 'reasonCode' | 'comment',
    /** What is wrong, in OL's words — never presented as the source's. */
    public readonly detail: string
  ) {
    super(
      `Decline request for return ${externalReturnId} is invalid (${field}): ${detail}`
    );
    this.name = 'ReturnDeclineInvalidRequestError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ReturnDeclineInvalidRequestError);
    }
  }
}
