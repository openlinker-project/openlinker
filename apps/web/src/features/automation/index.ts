/**
 * Automation — public surface (#2364)
 *
 * The feature's public barrel. Cross-feature and cross-plugin consumers import
 * only from here; deep imports into `features/automation/api|hooks|lib|components`
 * are banned by ESLint for those consumers (#609).
 *
 * The `/automations` pages are the only consumers today, and pages may deep-import
 * feature internals — these are listed so the seam is stable for the composer
 * (#2365) and the dry run + fired log (#2366), both of which build on this slice.
 *
 * @module apps/web/src/features/automation
 */
export type {
  AutomationActionAvailability,
  AutomationActionAvailabilityEntry,
  AutomationActionKind,
  AutomationActionVocabulary,
  AutomationFiringMode,
  AutomationRule,
  AutomationRuleWriteInput,
  AutomationRun,
  AutomationRunLog,
  AutomationTrigger,
  AutomationTriggerSummary,
  AutomationTriggerVocabulary,
  AutomationVocabulary,
} from './api/automation.types';
export {
  AUTOMATION_ACTION_AVAILABILITY_VALUES,
  AUTOMATION_ACTION_VALUES,
  AUTOMATION_FIRING_MODE_VALUES,
  AUTOMATION_TRIGGER_VALUES,
  isAutomationTrigger,
} from './api/automation.types';

export { createAutomationsApi } from './api/automation.api';
export type { AutomationsApi } from './api/automation.api';
export { automationQueryKeys } from './api/automation.query-keys';
export type { ParsedAutomationRules, ParsedAutomationSummary } from './api/automation.schema';

export { useAutomationVocabularyQuery } from './hooks/use-automation-vocabulary-query';
export { useAutomationSummaryQuery } from './hooks/use-automation-summary-query';
export { useAutomationRulesQuery } from './hooks/use-automation-rules-query';
export { useAutomationRunsQuery } from './hooks/use-automation-runs-query';
export { useSetAutomationActiveMutation } from './hooks/use-set-automation-active-mutation';
export type { SetAutomationActiveInput } from './hooks/use-set-automation-active-mutation';
// Mounted by the composer (#2365), which owns the delete affordance. Exported
// here rather than later so the invalidation rule (list AND summary) is written
// once, beside the arm/disarm mutation it must stay consistent with.
export { useDeleteAutomationMutation } from './hooks/use-delete-automation-mutation';

export { AutomationActionAvailabilityPanel } from './components/automation-action-availability-panel';
export { AutomationRuleAvailabilityNotice } from './components/automation-rule-availability-notice';
export { AutomationRulesList } from './components/automation-rules-list';
export { AutomationSuggestionCard } from './components/automation-suggestion-card';
export { AutomationTriggerIndex, buildTriggerRows } from './components/automation-trigger-index';
export type { AutomationTriggerRow } from './components/automation-trigger-index';

export { describeAvailability, readRuleAvailability } from './lib/action-availability';
export type { AvailabilityDescription, RuleAvailabilityVerdict } from './lib/action-availability';
export { describeTrigger } from './lib/automation-trigger-labels';
export {
  AUTOMATIONS_PAGE_COPY,
  AUTOMATION_ACTIVITY_COPY,
  AUTOMATION_AVAILABILITY_COPY,
  AUTOMATION_ERROR_COPY,
  AUTOMATION_FIRING_MODE_COPY,
  AUTOMATION_INDEX_COPY,
  AUTOMATION_RULES_COPY,
  AUTOMATION_SUGGESTION_COPY,
  AUTOMATION_TRIGGER_COPY,
} from './lib/automation.copy';
