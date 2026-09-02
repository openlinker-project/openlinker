/**
 * Automation Rule Not Found Error (#2358)
 *
 * No `automation_rules` row carries the requested id. Non-retryable: a retry
 * cannot change it.
 *
 * @module libs/core/src/automation/domain/exceptions
 */

/** No automation exists with this id. */
export class AutomationRuleNotFoundError extends Error {
  constructor(public readonly ruleId: string) {
    super(`No automation found with id "${ruleId}".`);
    this.name = 'AutomationRuleNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}
