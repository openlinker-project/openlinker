/**
 * Rule overlap check (#3190)
 *
 * Asks the backend whether the draft in the composer could match the same
 * order as a rule already saved. A QUERY rather than a mutation: the endpoint
 * persists nothing, and keying it on the draft means the answer is cached per
 * distinct draft instead of re-asked on every keystroke that changes nothing.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type {
  CheckSalesDocumentRuleOverlapInput,
  SalesDocumentRuleOverlapVerdict,
} from '../api/sales-document-rules.types';

export function useSalesDocumentRuleOverlapQuery(
  input: CheckSalesDocumentRuleOverlapInput,
  enabled: boolean,
): UseQueryResult<SalesDocumentRuleOverlapVerdict> {
  const apiClient = useApiClient();
  return useQuery({
    // The draft IS the key. Serialising it is what makes a re-render with an
    // unchanged draft free, and a genuinely changed draft a fresh question.
    queryKey: ['sales-document-rules', 'overlap-check', JSON.stringify(input)],
    queryFn: () => apiClient.salesDocumentRules.checkRuleOverlap(input),
    enabled,
    // A conflict verdict is about rules the operator may be editing in another
    // tab, so it is not worth caching beyond the dialog's own lifetime.
    staleTime: 0,
  });
}
