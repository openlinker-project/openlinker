/**
 * MCP Tokens — Transport Types
 *
 * Mirrors the backend `McpTokenResponseDto` / `McpTokenCreatedResponseDto`
 * (#1486), preserving backend camelCase naming.
 *
 * `rawToken` appears ONLY on the create response — the server shows it
 * exactly once and can never return it again.
 *
 * @module apps/web/src/features/mcp-tokens/api
 */

export const MCP_TOKEN_SCOPES = ['mcp:read', 'mcp:write'] as const;

export type McpTokenScope = (typeof MCP_TOKEN_SCOPES)[number];

export interface McpToken {
  id: string;
  /** Owner — the admin listing is deployment-wide, so rows must be attributable. */
  userId: string;
  name: string;
  scopes: McpTokenScope[];
  /** RFC 8707 resource this token was bound to at mint time. */
  resource: string;
  /** False when `resource` no longer matches the deployment's configured value. */
  resourceMatchesCurrent: boolean;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
}

export interface McpTokenCreated extends McpToken {
  /** Shown exactly once. Never persisted client-side. */
  rawToken: string;
}

export interface CreateMcpTokenInput {
  name: string;
  scope: McpTokenScope;
  expiresInDays?: number;
}
