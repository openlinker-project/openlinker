/**
 * Automation Reorder Mismatch Error (#3938)
 *
 * A reorder must name every rule of the trigger exactly once. Carries both
 * halves of the disagreement - the rules the request left out and the ids it
 * named that are not rules of that trigger - so the caller can say which.
 *
 * @module libs/core/src/automation/domain/exceptions
 */
export class AutomationReorderMismatchError extends Error {
  constructor(
    public readonly missingRuleIds: readonly string[],
    public readonly unknownRuleIds: readonly string[],
  ) {
    super(
      `The order must list every rule exactly once (missing: ${missingRuleIds.length}, unknown or repeated: ${unknownRuleIds.length}).`,
    );
    this.name = 'AutomationReorderMismatchError';
    Error.captureStackTrace(this, this.constructor);
  }
}
