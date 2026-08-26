/**
 * Automation Invalid Condition Error (#2358, Wave-2 spec §5.5)
 *
 * A condition submitted on the WRITE path does not narrow to the closed
 * `AutomationCondition` vocabulary.
 *
 * Deliberately asymmetric with the READ path, and the asymmetry is the point: a
 * malformed condition read back from `jsonb` is treated as "never matches"
 * rather than throwing, because one bad row must not crash every read of the
 * rule. On the way IN there is an operator to tell, so a bad condition is
 * refused loudly instead of being persisted as something that can never match.
 *
 * @module libs/core/src/automation/domain/exceptions
 */

/** A submitted condition is not a member of the closed condition vocabulary. */
export class AutomationInvalidConditionError extends Error {
  constructor(public readonly index: number) {
    super(`Condition at position ${index} is not a valid automation condition.`);
    this.name = 'AutomationInvalidConditionError';
    Error.captureStackTrace(this, this.constructor);
  }
}
