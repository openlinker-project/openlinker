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
  AutomationAmountOp,
  AutomationBlockedBy,
  AutomationConditionField,
  AutomationConditionOutcome,
  AutomationConditionTrace,
  AutomationDryRunResult,
  AutomationEvaluateInput,
  AutomationNonFiringReason,
  AutomationRunOutcome,
  AutomationStepResult,
  AutomationStepStatus,
  AutomationSubjectFacts,
  AutomationVerdict,
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
  AUTOMATION_AMOUNT_OP_VALUES,
  AUTOMATION_CARRIER_CAPABILITY,
  AUTOMATION_CONDITION_FIELD_VALUES,
  AUTOMATION_CONDITION_OUTCOME_VALUES,
  AUTOMATION_MERGE_FIELDS,
  AUTOMATION_NON_FIRING_REASON_VALUES,
  AUTOMATION_RUN_OUTCOME_VALUES,
  AUTOMATION_STEP_STATUS_VALUES,
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
export { useCreateAutomationMutation } from './hooks/use-create-automation-mutation';
export { useEvaluateAutomationMutation } from './hooks/use-evaluate-automation-mutation';
export { useSubjectAutomationRunsQuery } from './hooks/use-subject-automation-runs-query';
export { useAutomationRunFeedQuery } from './hooks/use-automation-run-feed-query';

export { AutomationActionAvailabilityPanel } from './components/automation-action-availability-panel';
export { AutomationRuleAvailabilityNotice } from './components/automation-rule-availability-notice';
export { AutomationRulesList } from './components/automation-rules-list';
export { AutomationSuggestionCard } from './components/automation-suggestion-card';
export { AutomationTriggerIndex, buildTriggerRows } from './components/automation-trigger-index';
export {
  AutomationComposerDialog,
  selectCarrierConnections,
  seedActions,
} from './components/automation-composer-dialog';
export type { AutomationComposerDialogProps } from './components/automation-composer-dialog';
export { AutomationConditionRow } from './components/automation-condition-row';
export { AutomationActionRow } from './components/automation-action-row';
export { AutomationMergeFields } from './components/automation-merge-fields';
export { AutomationDryRunPanel } from './components/automation-dry-run-panel';
export { AutomationRunLogPanel } from './components/automation-run-log';
export { AutomationActivityTable } from './components/automation-activity-table';
export type { AutomationTriggerRow } from './components/automation-trigger-index';

export { describeAvailability, readRuleAvailability } from './lib/action-availability';
export type { AvailabilityDescription, RuleAvailabilityVerdict } from './lib/action-availability';
export { describeTrigger } from './lib/automation-trigger-labels';
export { describeAutomationWriteError } from './lib/automation-write-error';
export {
  conditionOutcomeTone,
  describeConditionOutcome,
  describeNonFiringReason,
  draftNeedsDryRun,
  fingerprintDraft,
  resolveDryRunGate,
  siblingVerdicts,
  subjectVerdict,
  verdictHeadline,
} from './lib/dry-run-verdict';
export type { DryRunGateState, VerdictHeadline } from './lib/dry-run-verdict';
export { describeStepStatus, stepStatusTone } from './lib/step-status';
export { runOutcomeTone } from './lib/run-outcome';
export type { RunOutcomeTone } from './lib/run-outcome';
export {
  AUTOMATION_ACTIVITY_FILTER_PARAMS,
  AUTOMATION_ACTIVITY_OFFSET_PARAM,
  clearAutomationActivityFilters,
  hasActiveAutomationActivityFilters,
  readAutomationActivityFilters,
  readAutomationActivityOffset,
  readIsoDateParam,
  setAutomationActivityFilterParam,
  setAutomationActivityOffsetParam,
} from './lib/automation-activity-filters';
export type { AutomationActivityFilters } from './lib/automation-activity-filters';
export type {
  AutomationErrorTarget,
  AutomationWriteRefusal,
} from './lib/automation-write-error';
export {
  automationComposerSchema,
  newActionDraft,
  newConditionDraft,
  toActionInput,
  toConditionInput,
} from './lib/automation-composer.schema';
export type {
  AutomationActionDraft,
  AutomationComposerValues,
  AutomationConditionDraft,
} from './lib/automation-composer.schema';
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
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_COMPOSER_COPY,
  AUTOMATION_CONDITION_FIELD_LABELS,
  AUTOMATION_CONDITION_OUTCOME_COPY,
  AUTOMATION_DRY_RUN_COPY,
  AUTOMATION_NON_FIRING_REASON_COPY,
  AUTOMATION_RUN_LOG_COPY,
  AUTOMATION_RUN_OUTCOME_COPY,
  AUTOMATION_STEP_STATUS_COPY,
} from './lib/automation.copy';

// ── AF-X: "an automation couldn't finish" (#2387) ────────────────────────────
export {
  automationFailureTitle,
  buildAutomationFailureView,
  retryRefusalCopy,
  stepReasonText,
} from './lib/automation-failure';
export type { AutomationFailureView } from './lib/automation-failure';
export {
  AUTOMATION_FAILURE_COPY,
  AUTOMATION_FAILURE_TITLE,
  RETRY_REFUSAL_COPY,
} from './lib/automation.copy';
export { useRetryAutomationRunMutation } from './hooks/use-retry-automation-run-mutation';
export { useDismissAutomationRunMutation } from './hooks/use-dismiss-automation-run-mutation';
export type { RetryRefusalReason, AutomationStepReport } from './api/automation.types';
