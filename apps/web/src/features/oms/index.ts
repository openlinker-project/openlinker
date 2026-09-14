/**
 * OMS — public surface (#3056)
 *
 * Transport, hooks, the ordered rule table and the authoring dialog for the
 * #2953 sourcing-rules admin API, composed into one section that owns the
 * read's four states and all three dialogs. The page and its tile arrive with
 * #3060 / #3062 and add their own lines here.
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

// #3060 - the /settings entry point.
export { SourcingRulesTile } from './components/sourcing-rules-tile';
export {
  useInventoryLocationsForRulesQuery,
  SOURCING_RULE_LOCATION_PAGE_SIZE,
} from './hooks/use-inventory-locations-for-rules-query';
export type { SourcingRuleLocationsPage } from './hooks/use-inventory-locations-for-rules-query';

// #3061 - the composed section: states + table + dialogs.
export { SourcingRulesSection } from './components/sourcing-rules-section';
export type { SourcingRulesSectionProps } from './components/sourcing-rules-section';
export { SourcingRuleLockedDialog } from './components/sourcing-rule-locked-dialog';
export type { SourcingRuleLockedDialogProps } from './components/sourcing-rule-locked-dialog';

// #3059 - removal.
export { SourcingRuleDeleteDialog } from './components/sourcing-rule-delete-dialog';
export type { SourcingRuleDeleteDialogProps } from './components/sourcing-rule-delete-dialog';

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
  SOURCING_RULES_STATE_COPY,
  SOURCING_RULES_TILE_COPY,
  SOURCING_RULES_PAGE_COPY,
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
