/**
 * OMS — public surface (#3056)
 *
 * Transport, hooks, the ordered rule table and the authoring dialog for the
 * #2953 sourcing-rules admin API. The delete/retire flow, the page and its tile
 * arrive with #3059-#3062 and add their own lines here.
 *
 * Deliberately NOT exported, per the start-narrow rule: the api module itself
 * (consumers reach transport through the hooks) and the query keys (every
 * mutation already invalidates the connection). Adding either back is one line
 * on the day something needs it.
 *
 * @module apps/web/src/features/oms
 */
export { useSourcingRulesQuery } from './hooks/use-sourcing-rules-query';
export { useSourcingRuleQuery } from './hooks/use-sourcing-rule-query';
export {
  useCreateSourcingRuleMutation,
  type CreateSourcingRuleInput,
} from './hooks/use-create-sourcing-rule-mutation';
export {
  useUpdateSourcingRuleMutation,
  type UpdateSourcingRuleInput,
} from './hooks/use-update-sourcing-rule-mutation';
export {
  useDeleteSourcingRuleMutation,
  type DeleteSourcingRuleInput,
} from './hooks/use-delete-sourcing-rule-mutation';
export {
  useReorderSourcingRulesMutation,
  type ReorderSourcingRulesInput,
} from './hooks/use-reorder-sourcing-rules-mutation';

// #3057 - the ordered table.
export { SourcingRulesTable } from './components/sourcing-rules-table';
export type { SourcingRulesTableProps } from './components/sourcing-rules-table';

// #3058 - authoring.
export { SourcingRuleDialog } from './components/sourcing-rule-dialog';
export type {
  SourcingRuleDialogProps,
  SourcingRuleLocationOption,
} from './components/sourcing-rule-dialog';

export { resolveSplitCeiling, type SplitCeiling } from './lib/sourcing-rule-ceiling';
export {
  isLiveSourcingRule,
  resolveSourcingRuleStatus,
  SOURCING_RULE_STATUS_VALUES,
  type SourcingRuleStatus,
  type SourcingRuleStatusView,
} from './lib/sourcing-rule-status';
export {
  sourcingAfterActionHint,
  sourcingAfterActionLabel,
  sourcingRuleNameHint,
  sourcingRuleNameLabel,
  SOURCING_RULES_TABLE_COPY,
} from './lib/sourcing-rule.copy';
export {
  AFTER_ACTION_PERMISSIVENESS,
  mostRestrictiveAfterAction,
  SOURCING_AFTER_ACTION_VALUES,
  SOURCING_FILTER_NAME_VALUES,
  SOURCING_RULE_KIND_VALUES,
  SOURCING_SORT_NAME_VALUES,
  type SourcingAfterAction,
  type SourcingFilterName,
  type SourcingRuleKind,
  type SourcingSortName,
} from './lib/sourcing-rule-vocabulary';

export {
  describeSourcingRuleError,
  readSourcingRuleConflict,
  type SourcingRuleConflict,
} from './lib/sourcing-rule-conflict';

export type {
  CreateSourcingRuleRequest,
  ReorderSourcingRulesRequest,
  SourcingRule,
  SourcingRuleFilters,
  UpdateSourcingRuleRequest,
} from './api/sourcing-rules.types';
