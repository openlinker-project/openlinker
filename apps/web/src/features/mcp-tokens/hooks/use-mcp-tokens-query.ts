/**
 * MCP Tokens Query Hook
 *
 * Reads the MCP token list. Gated on admin role so non-admin sessions
 * don't trigger a 403 round-trip, matching the `mailer-settings` /
 * `ai-provider-settings` precedent.
 *
 * @module apps/web/src/features/mcp-tokens/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { mcpTokensQueryKeys } from '../api/mcp-tokens.query-keys';
import type { McpToken } from '../api/mcp-tokens.types';

export function useMcpTokensQuery(): UseQueryResult<McpToken[]> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const isAdmin = session.status === 'authenticated' && session.user?.role === 'admin';

  return useQuery({
    queryKey: mcpTokensQueryKeys.list(),
    queryFn: () => apiClient.mcpTokens.list(),
    enabled: isAdmin,
  });
}
