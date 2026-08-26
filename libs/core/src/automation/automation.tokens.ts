/**
 * Automation DI Tokens (#2358)
 *
 * Symbols only — `export *`-ed from the context barrel, so a new token is
 * available on `@openlinker/core/automation` without a second edit
 * (engineering-standards § Symbol DI Token Re-export Convention).
 *
 * @module libs/core/src/automation
 */

export const AUTOMATION_RULE_REPOSITORY_TOKEN = Symbol('AutomationRuleRepositoryPort');
export const AUTOMATION_RULES_SERVICE_TOKEN = Symbol('IAutomationRulesService');
export const AUTOMATION_TRIGGER_FIRING_REPOSITORY_TOKEN = Symbol(
  'AutomationTriggerFiringRepositoryPort',
);
export const AUTOMATION_DISPATCH_SERVICE_TOKEN = Symbol('IAutomationDispatchService');
export const AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN = Symbol(
  'IAutomationTriggerEmissionService',
);

export const AUTOMATION_RUN_RECORDER_TOKEN = Symbol('IAutomationRunRecorderService');
