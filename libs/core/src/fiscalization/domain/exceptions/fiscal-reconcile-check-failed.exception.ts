/**
 * Fiscal Reconcile Check Failed Exception
 *
 * Raised when the provider could not be ASKED - the locator threw a transport
 * or infrastructure failure instead of answering.
 *
 * It exists so a failed check can never be mistaken for one of the four
 * {@link FiscalReconcileOutcome} answers. The locator contract already forbids
 * reading a throw as "no match" (that would report an absence the provider never
 * asserted); this exception is the other half of that rule at the application
 * boundary, keeping `unsupported` - a structural fact about the ADAPTER - apart
 * from a transient fact about the NETWORK, which is retryable and which an
 * operator surface should offer to retry rather than explain away.
 *
 * Nothing is written when it is raised: the record is left exactly as it was,
 * still in doubt, and no resend is licensed by it.
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
export class FiscalReconcileCheckFailedException extends Error {
  constructor(
    public readonly recordId: string,
    public readonly connectionId: string,
    /** Bounded, PII-free summary of what went wrong. Safe to expose. */
    public readonly reason: string,
  ) {
    super(
      `Could not ask the provider on connection ${connectionId} about fiscal registration ` +
        `record ${recordId}: ${reason}. Nothing changed; the record is still in doubt and the ` +
        `check can be repeated.`,
    );
    this.name = 'FiscalReconcileCheckFailedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
