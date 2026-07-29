/**
 * Create MCP Token Mutation Hook
 *
 * Mints a token and invalidates the list. The returned `rawToken` is
 * handed to the caller for the one-time reveal and is never cached — the
 * mutation result is intentionally not written into the Query cache.
 *
 * @module apps/web/src/features/mcp-tokens/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mcpTokensQueryKeys } from '../api/mcp-tokens.query-keys';
import type { CreateMcpTokenInput, McpTokenCreated } from '../api/mcp-tokens.types';

export function useCreateMcpTokenMutation(): UseMutationResult<
  McpTokenCreated,
  Error,
  CreateMcpTokenInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateMcpTokenInput) => apiClient.mcpTokens.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpTokensQueryKeys.all });
    },
  });
}
