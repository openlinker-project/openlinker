/**
 * MCP Tokens — Query Key Factory
 *
 * `all` is the invalidation root used by the create/revoke mutations.
 *
 * @module apps/web/src/features/mcp-tokens/api
 */

export const mcpTokensQueryKeys = {
  all: ['mcp-tokens'] as const,
  list: () => ['mcp-tokens', 'list'] as const,
};
