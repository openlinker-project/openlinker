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
