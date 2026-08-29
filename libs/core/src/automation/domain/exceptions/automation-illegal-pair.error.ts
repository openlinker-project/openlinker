/**
 * Automation Illegal Pair Error (#2359, Wave-2 spec §5.4)
 *
 * A submitted rule pairs a trigger with an action the §5.4 legality matrix
 * forbids — *"when a return is received, buy a shipping label"*. Such a rule
 * would save, arm, and then do nothing forever, with no error anywhere; the
 * operator's only signal would be its absence.
 *
 * Raised on the WRITE path, where there is an operator to tell. The evaluator
 * meets the same pair as a non-firing `illegal-trigger-action-pair` reason
 * rather than as a throw, because by then the rule is persisted and one bad row
 * must not crash evaluation for every other rule on the trigger.
 *
 * The message names the offending pair, which is what #2363's 400 renders.
 *
 * @module libs/core/src/automation/domain/exceptions
 */

/** A submitted step is not legal for the rule's trigger. */
export class AutomationIllegalPairError extends Error {
  constructor(
    public readonly trigger: string,
    public readonly action: string,
    public readonly index: number,
  ) {
    super(
      `Action "${action}" at position ${index} is not available for trigger "${trigger}".`,
    );
    this.name = 'AutomationIllegalPairError';
    Error.captureStackTrace(this, this.constructor);
  }
}
