/**
 * Automation Illegal Condition Field Error (#2359, Wave-2 spec §5.5 divergence 2)
 *
 * A submitted rule is scoped by a condition field its trigger may not carry —
 * in v1, a `holdReason` condition on anything but T1/T2/T3. The facts for such
 * a trigger can never assert a hold reason, so the condition would read
 * permanently `unknown` and the rule would save, arm, and never fire.
 *
 * Raised on the WRITE path, where there is an operator to tell. The evaluator
 * meets the same condition as an ordinary `unknown` outcome with the offending
 * row visible in its trace — an explanation rather than a bare rejection, which
 * is the right posture for a row that already exists.
 *
 * @module libs/core/src/automation/domain/exceptions
 */

/** A submitted condition field is not available for the rule's trigger. */
export class AutomationIllegalConditionFieldError extends Error {
  constructor(
    public readonly trigger: string,
    public readonly field: string,
    public readonly index: number,
  ) {
    super(
      `Condition field "${field}" at position ${index} is not available for trigger "${trigger}".`,
    );
    this.name = 'AutomationIllegalConditionFieldError';
    Error.captureStackTrace(this, this.constructor);
  }
}
