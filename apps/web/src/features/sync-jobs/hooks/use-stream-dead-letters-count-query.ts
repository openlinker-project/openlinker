import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { streamDeadLettersQueryKeys } from '../api/stream-dead-letters.query-keys';
import type { StreamDeadLettersCount, StreamDeadLetterFilters } from '../api/stream-dead-letters.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useStreamDeadLettersCountQuery(
  filters?: StreamDeadLetterFilters
): UseQueryResult<StreamDeadLettersCount> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: streamDeadLettersQueryKeys.count(filters),
    queryFn: () => apiClient.streamDeadLetters.count(filters),
  });
}
