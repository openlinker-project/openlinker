/**
 * Fiscal Registration Not In Doubt Exception
 *
 * Raised when reconciliation is asked to settle a record that is not in the one
 * state reconciliation exists for (`failed` + `in-doubt`).
 *
 * Deliberately a refusal rather than a no-op: reconciliation crosses the
 * provider boundary, and running it against an already-`registered` row - or one
 * whose attempt is still in flight - would spend a provider call to learn
 * something OL already knows, on the exact rows where a mistaken write would be
 * most damaging.
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
export class FiscalRegistrationNotInDoubtException extends Error {
  constructor(id: string, status: string) {
    super(
      `Fiscal registration record ${id} is ${status}, not an in-doubt failure; ` +
        `there is nothing to reconcile`,
    );
    this.name = 'FiscalRegistrationNotInDoubtException';
    Error.captureStackTrace(this, this.constructor);
  }
}
