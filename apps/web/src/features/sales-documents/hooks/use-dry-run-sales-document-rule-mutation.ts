/**
 * useDryRunSalesDocumentRuleMutation (#3191)
 *
 * Deliberately invalidates NOTHING on success — unlike every other mutation in
 * this feature. A dry run persists no row, so there is no cached list this
 * result could stale; wiring `onSuccess` to `salesDocumentRulesQueryKeys.all`
 * would be a no-op that invites a reader to assume a write happened here.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type {
  DryRunSalesDocumentRuleInput,
  SalesDocumentDryRunResult,
} from '../api/sales-document-rules.types';

export function useDryRunSalesDocumentRuleMutation(): UseMutationResult<
  SalesDocumentDryRunResult,
  Error,
  DryRunSalesDocumentRuleInput
> {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (input) => apiClient.salesDocumentRules.dryRunRule(input),
  });
}
