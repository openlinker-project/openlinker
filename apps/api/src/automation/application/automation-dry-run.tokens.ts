/**
 * Automation Dry-Run DI Token (#2363)
 *
 * The `<ctx>.tokens.ts` convention applied one layer out: the dry run is an
 * `apps/api` application service (it composes two core contexts that may not
 * import each other), so its token lives beside it rather than in
 * `automation.tokens.ts`.
 *
 * @module apps/api/src/automation/application
 */
export const AUTOMATION_DRY_RUN_SERVICE_TOKEN = Symbol('IAutomationDryRunService');

export type { IAutomationDryRunService } from './automation-dry-run.service.interface';
