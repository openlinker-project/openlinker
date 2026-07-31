/**
 * Revoke MCP Token Mutation Hook
 *
 * @module apps/web/src/features/mcp-tokens/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mcpTokensQueryKeys } from '../api/mcp-tokens.query-keys';

export function useRevokeMcpTokenMutation(): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.mcpTokens.revoke(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpTokensQueryKeys.all });
    },
  });
}
