/**
 * Return Restock Attestation Invalid Error
 *
 * Raised when `markStockHandledManually` is asked to attest a line that has
 * nothing outstanding to attest to (#2370).
 *
 * Refused rather than treated as a no-op, deliberately. The attestation MOVES
 * UNITS — it takes them out of "received but undealt-with" and into
 * `quantityRestocked` with `restockedBy: 'operator_out_of_band'` (spec § 5.4) —
 * so a silent success on a line with no block would leave an operator believing
 * they had resolved something, with no record and no change. An alarm that
 * clears when nothing was wrong is how an operator learns to distrust the alarm.
 *
 * @module domain/exceptions
 */
export class ReturnRestockAttestationInvalidError extends Error {
  constructor(public readonly lineId: string) {
    super(
      `Return line ${lineId} has no blocked or in-doubt restock to attest to; ` +
        'nothing was changed'
    );
    this.name = 'ReturnRestockAttestationInvalidError';
    Error.captureStackTrace(this, this.constructor);
  }
}
