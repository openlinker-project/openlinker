/**
 * MCP Tokens API Client
 *
 * Thin HTTP adapter over the admin-only `/mcp/tokens` endpoints (#1486).
 *
 * `create` is the only call that ever receives a raw token value; nothing
 * here persists it — the caller holds it in component state for the
 * one-time reveal and drops it on dismiss.
 *
 * @module apps/web/src/features/mcp-tokens/api
 */
import type { CreateMcpTokenInput, McpToken, McpTokenCreated } from './mcp-tokens.types';

export interface McpTokensApi {
  list: () => Promise<McpToken[]>;
  create: (input: CreateMcpTokenInput) => Promise<McpTokenCreated>;
  revoke: (id: string) => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createMcpTokensApi(request: ApiRequest): McpTokensApi {
  return {
    list(): Promise<McpToken[]> {
      return request<McpToken[]>('/mcp/tokens');
    },
    create(input): Promise<McpTokenCreated> {
      return request<McpTokenCreated>('/mcp/tokens', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async revoke(id): Promise<void> {
      await request<void>(`/mcp/tokens/${id}`, { method: 'DELETE' });
    },
  };
}
