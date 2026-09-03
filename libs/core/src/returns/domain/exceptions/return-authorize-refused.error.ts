/**
 * Return Authorize Refused Error (#2372, ADR-060 / ADR-044)
 *
 * The refusal SPECIFIC to `return.authorize` — and today it carries exactly one
 * reason, which is the whole point of the slice rather than a placeholder.
 *
 * **OL authorizes only returns it authored.** A `source_ingested` return was
 * already decided by the marketplace; OL restating that decision would be OL
 * putting words in the source's mouth, which is the asymmetry ADR-060 exists to
 * preserve (OL DECLINES where the platform allows it, and AUTHORIZES only its
 * own). So the refusal is a named error rather than a silent no-op: an operator
 * clicking Authorize on a marketplace return must be told why nothing happened.
 *
 * The other two ways this write is refused — "no such return" and "the return is
 * an orphan" — are not specific to it. They are the vocabulary EVERY downstream
 * trigger is refused by (`ReturnNotFoundError` / `ReturnNotAttributedError`,
 * #2332), and re-declaring either here would recreate the two-rival-classes
 * defect `return-decline-unsupported.error.ts` documents at length.
 *
 * Non-retryable: `origin` is insert-only, so a retry cannot change the answer.
 *
 * @module domain/exceptions
 */

export const ReturnAuthorizeRefusalReasonValues = [
  /**
   * The return came from a source feed, so the SOURCE decided it. OL has no
   * standing to authorize it and will not pretend otherwise.
   */
  'source-ingested',
] as const;

export type ReturnAuthorizeRefusalReason = (typeof ReturnAuthorizeRefusalReasonValues)[number];

const REASON_DETAIL: Record<ReturnAuthorizeRefusalReason, string> = {
  'source-ingested':
    'it was ingested from a source, which already decided it — OpenLinker authorizes ' +
    'only returns an operator opened here',
};

export class ReturnAuthorizeRefusedError extends Error {
  constructor(
    public readonly returnId: string,
    public readonly reason: ReturnAuthorizeRefusalReason
  ) {
    super(`Cannot authorize return ${returnId}: ${REASON_DETAIL[reason]}`);
    this.name = 'ReturnAuthorizeRefusedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
