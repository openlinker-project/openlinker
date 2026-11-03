import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { streamDeadLettersQueryKeys } from '../api/stream-dead-letters.query-keys';
import type {
  PaginatedStreamDeadLetters,
  StreamDeadLetterFilters,
  StreamDeadLetterPagination,
} from '../api/stream-dead-letters.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useStreamDeadLettersQuery(
  filters?: StreamDeadLetterFilters,
  pagination?: StreamDeadLetterPagination
): UseQueryResult<PaginatedStreamDeadLetters> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: streamDeadLettersQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.streamDeadLetters.list(filters, pagination),
  });
}
