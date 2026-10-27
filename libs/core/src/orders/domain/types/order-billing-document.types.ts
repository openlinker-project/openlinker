/**
 * Order Billing Document types (#3549)
 *
 * The neutral input and outcome of attaching an issued sales document to the
 * order it was issued for, on the marketplace that order came from. Like the
 * lifecycle relay (ADR-027) this is a fact pushed back to the originating
 * order, so the outcome is reported as DATA rather than thrown or encoded in
 * the type signature: a marketplace that has no such endpoint answers
 * `unsupported`, which is a declined capability and never an error.
 *
 * Country-agnostic (ADR-026): the document is opaque bytes plus a number and a
 * file name; nothing here names a regime, a provider or a platform.
 *
 * @module libs/core/src/orders/domain/types
 * @see {@link OrderBillingDocumentUploader} for the capability that consumes it
 */

/**
 * - `uploaded`          - the marketplace accepted the document.
 * - `already-present`   - the marketplace already holds a document for this
 *                         order. A repeated upload (a job retry, a manual retry
 *                         after the first call actually landed) must read as
 *                         done, never as a failure.
 * - `unsupported`       - this marketplace cannot take a billing document.
 *                         Structural, so never retried.
 * - `rejected`          - the marketplace refused THIS document (wrong format,
 *                         too large, order closed). Deterministic: retrying the
 *                         same bytes gets the same answer.
 * - `transient-failure` - the call did not settle (timeout, 5xx, throttling).
 *                         The only outcome a retry can change.
 */
export const BillingDocumentUploadOutcomeValues = [
  'uploaded',
  'already-present',
  'unsupported',
  'rejected',
  'transient-failure',
] as const;
export type BillingDocumentUploadOutcome = (typeof BillingDocumentUploadOutcomeValues)[number];

export interface UploadBillingDocumentInput {
  /** The marketplace's own id of the order the document belongs to. */
  externalOrderId: string;
  /** The document's own number, as the marketplace shows it to the buyer. */
  documentNumber: string;
  /** File name to present; the adapter may adjust the extension to the media type. */
  fileName: string;
  contentType: string;
  content: Uint8Array;
}

export interface UploadBillingDocumentResult {
  outcome: BillingDocumentUploadOutcome;
  /**
   * Operator-readable reason, required for every outcome but the two successes.
   * It is a sentence OpenLinker or the adapter wrote - an adapter must never
   * copy a platform response body here, which can carry order data.
   */
  detail?: string;
}
