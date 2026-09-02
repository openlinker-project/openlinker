/**
 * Automation Retry DI token (#2387)
 *
 * Mirrors `automation-dry-run.tokens.ts` — an `apps/api` composition service, so
 * its token lives beside it rather than in the core context's tokens file.
 *
 * @module apps/api/src/automation/application
 */
export const AUTOMATION_RETRY_SERVICE_TOKEN = Symbol('IAutomationRetryService');
