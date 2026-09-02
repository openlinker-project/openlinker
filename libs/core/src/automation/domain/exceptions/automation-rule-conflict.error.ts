/**
 * Automation Rule Conflict Error (#2358, Wave-2 spec §5.5)
 *
 * The save-time duplicate guard's refusal: a rule with an identical definition
 * — same trigger, same trigger parameters, same conditions, same actions in the
 * same order — already covers an OVERLAPPING effective window.
 *
 * Two identical rules both active would both fire, doubling every email and
 * every label. Two identical rules with NON-overlapping windows are legitimate
 * (that is the versioning case) and are not refused.
 *
 * **This is not the money-collision guard.** Spec §5.5 divergence 3 places the
 * #2047 at-most-one rule at RUNTIME (#2362); the save-time guard only warns
 * where it can see an overlap. Two rules with the same trigger and the same
 * irreversible action but DIFFERENT conditions, both matching one order, is the
 * S3-3 scenario and passes this guard cleanly by design.
 *
 * Raised by `AutomationRulesService` (semantic, on an overlapping range) and by
 * `AutomationRuleRepository` (exact, translating the unique-index violation), so
 * a concurrent race surfaces as this domain error rather than a raw 500.
 *
 * @module libs/core/src/automation/domain/exceptions
 */

/** An identical rule definition already covers an overlapping effective window. */
export class AutomationRuleConflictError extends Error {
  constructor(
    public readonly trigger: string,
    public readonly definitionHash: string,
    public readonly conflictingRuleId: string | null,
  ) {
    super(
      `An automation with an identical definition already covers an overlapping ` +
        `date range for trigger "${trigger}"` +
        (conflictingRuleId === null ? '.' : ` (rule ${conflictingRuleId}).`),
    );
    this.name = 'AutomationRuleConflictError';
    Error.captureStackTrace(this, this.constructor);
  }
}
