/**
 * MCP Token Types
 *
 * Domain types for OpenLinker-issued MCP Personal Access Tokens (#1486,
 * ADR-034). OL acts as an OAuth 2.1 Resource Server that validates its own
 * user-issued bearer tokens; these types describe the persisted shape.
 *
 * Scope model: `mcp:write` IMPLIES `mcp:read`, and the service stores BOTH
 * when write is requested. That keeps implication logic out of the verifier
 * and lets the MCP SDK's plain `requiredScopes` superset check do the
 * enforcing unmodified. The trade-off is deliberate: the implication rule is
 * denormalised into the data, so changing it later needs a data migration.
 *
 * @module libs/core/src/users/domain/types
 */

export const McpTokenScopeValues = ['mcp:read', 'mcp:write'] as const;

export type McpTokenScope = (typeof McpTokenScopeValues)[number];

export const McpTokenRevocationReasonValues = ['revoked_by_admin', 'rotated'] as const;

export type McpTokenRevocationReason = (typeof McpTokenRevocationReasonValues)[number];

/**
 * Narrow a raw `scopes` column value into the domain union.
 *
 * Mirrors `parseRefreshTokenRevocationReason`: a value outside the documented
 * set signals data corruption (manual edit / unrecognised migration) and
 * fails loud rather than silently shaping an invalid domain object.
 */
export function parseMcpTokenScopes(values: readonly string[]): McpTokenScope[] {
  return values.map((value) => {
    if ((McpTokenScopeValues as readonly string[]).includes(value)) {
      return value as McpTokenScope;
    }
    throw new Error(`Invalid mcp_tokens.scopes entry: ${value}`);
  });
}

/**
 * Narrow a raw `revoked_reason` column value into the domain union.
 */
export function parseMcpTokenRevocationReason(
  value: string | null
): McpTokenRevocationReason | null {
  if (value === null) return null;
  if ((McpTokenRevocationReasonValues as readonly string[]).includes(value)) {
    return value as McpTokenRevocationReason;
  }
  throw new Error(`Invalid mcp_tokens.revoked_reason: ${value}`);
}
