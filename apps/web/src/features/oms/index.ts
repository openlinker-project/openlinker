/**
 * OMS — public surface (#3056)
 *
 * The first `features/oms` slice: transport and hooks for the #2953
 * sourcing-rules admin API. Components, the page and its tile arrive with
 * #3057-#3062 and add their own lines here.
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
