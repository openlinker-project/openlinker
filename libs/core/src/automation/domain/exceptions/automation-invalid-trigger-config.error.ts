/**
 * Automation Invalid Trigger Config Error (#2358, Wave-2 spec §5.2)
 *
 * The submitted `triggerConfig` does not match the shape its trigger declares —
 * a T3 without a positive `withinHours`, or parameters supplied for one of the
 * six parameterless triggers.
 *
 * The check is per-trigger rather than union-wide, so a T3 threshold submitted
 * against T5 is refused instead of quietly validating as "some known config
 * shape" and then being ignored forever by a sweep that never reads it.
 *
 * @module libs/core/src/automation/domain/exceptions
 */

/** The trigger parameters do not match the shape this trigger declares. */
export class AutomationInvalidTriggerConfigError extends Error {
  constructor(public readonly trigger: string) {
    super(`The supplied parameters are not valid for trigger "${trigger}".`);
    this.name = 'AutomationInvalidTriggerConfigError';
    Error.captureStackTrace(this, this.constructor);
  }
}
