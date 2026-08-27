/**
 * useReturnProposalQuery (#2382)
 *
 * Reads the credit-note proposal PREVIEW for one return.
 *
 * Its own query rather than a field on the detail read, because it is a
 * computation over the invoice's issued-line snapshot rather than a fact about
 * the return — and it is deliberately not fetched for an ORPHAN, which the
 * backend refuses with a 409 (attribute it first).
 *
 * @module apps/web/src/features/returns/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { ReturnCorrectionProposalResult } from '../api/returns.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useReturnProposalQuery(
  returnId: string,
  enabled: boolean,
): UseQueryResult<ReturnCorrectionProposalResult, Error> {
  const apiClient = useApiClient();

  return useQuery<ReturnCorrectionProposalResult, Error>({
    queryKey: returnsQueryKeys.correctionProposal(returnId),
    queryFn: () => apiClient.returns.getCorrectionProposal(returnId),
    enabled,
  });
}
