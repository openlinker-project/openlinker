/**
 * MCP Principal Types
 *
 * Shapes for carrying the OpenLinker principal across the MCP auth seam
 * (#1486).
 *
 * SECURITY INVARIANT (plan §3.6.1): the SDK's `AuthInfo` carries the RAW
 * bearer token in its `token` field. It is attached to `req.auth` and
 * surfaced to every tool handler as `ctx.authInfo` (NOT `ctx.http.authInfo` —
 * that path appears in the SDK's own prose but is not the shape its types
 * declare; verified against the shipped `.d.cts`). It must therefore
 * NEVER be logged, serialized, or returned wholesale — anything that needs
 * to record the caller uses `McpAuthInfoExtra` / `redactPrincipal` below.
 * #1487's audit log inherits this invariant.
 *
 * @module apps/api/src/mcp/auth
 */
import type { McpTokenScope, UserRole } from '@openlinker/core/users';

/**
 * What OL stows in `AuthInfo.extra`. Deliberately carries no raw token and
 * no hash — this is the safe-to-log projection.
 */
export interface McpAuthInfoExtra {
  readonly mcpTokenId: string;
  readonly tokenName: string;
  readonly olUserId: string;
  readonly olRole: UserRole;
}

/** Redacted, safe-to-log view of an authenticated MCP caller. */
export interface RedactedMcpPrincipal {
  readonly mcpTokenId: string;
  readonly olUserId: string;
  readonly olRole: UserRole;
  readonly scopes: readonly McpTokenScope[];
}

/**
 * Type guard for the `extra` bag coming back off an `AuthInfo`.
 * `AuthInfo.extra` is `Record<string, unknown>`, so consumers must narrow.
 */
export function isMcpAuthInfoExtra(value: unknown): value is McpAuthInfoExtra {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mcpTokenId === 'string' &&
    typeof candidate.tokenName === 'string' &&
    typeof candidate.olUserId === 'string' &&
    typeof candidate.olRole === 'string'
  );
}
