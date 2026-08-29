/**
 * Automation Invalid Action Error (#2358, Wave-2 spec §5.3b)
 *
 * A step submitted on the WRITE path does not narrow to the closed
 * `AutomationAction` vocabulary — an unknown action, or a known one whose
 * parameters are missing or the wrong shape (an A2 with no carrier, an A6 with
 * no note).
 *
 * Same read/write asymmetry as `AutomationInvalidConditionError`, and it matters
 * more here: a malformed action that persisted as "valid" would reach an
 * executor on the money path.
 *
 * @module libs/core/src/automation/domain/exceptions
 */

/** A submitted step is not a valid automation action. */
export class AutomationInvalidActionError extends Error {
  constructor(public readonly index: number) {
    super(`Action at position ${index} is not a valid automation action.`);
    this.name = 'AutomationInvalidActionError';
    Error.captureStackTrace(this, this.constructor);
  }
}
