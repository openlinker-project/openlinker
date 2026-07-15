/**
 * useNumberingAssignmentQuery (#1577)
 *
 * Reads a connection's numbering assignment. The C2 endpoint returns 404 when
 * no assignment is configured — that is the "not set up yet" state, not a
 * failure, so it maps to `null`. Any other error propagates to the query's
 * error state.
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ApiError } from '../../../shared/api/api-error';
import { numberingQueryKeys } from '../api/numbering.query-keys';
import type { NumberingAssignment } from '../api/numbering.types';

export function useNumberingAssignmentQuery(
  connectionId: string,
): UseQueryResult<NumberingAssignment | null> {
  const apiClient = useApiClient();

  return useQuery<NumberingAssignment | null>({
    queryKey: numberingQueryKeys.assignment(connectionId),
    enabled: connectionId.length > 0,
    queryFn: async (): Promise<NumberingAssignment | null> => {
      try {
        return await apiClient.invoiceNumbering.getAssignment(connectionId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
}
