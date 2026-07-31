/**
 * MCP Token Application Types
 *
 * Input/output shapes for `IMcpTokenService` (#1486). Every type here is
 * platform-neutral — no MCP-SDK type appears in `libs/core`, so the SDK
 * dependency stays in the Interface layer where ADR-033 puts it.
 *
 * @module libs/core/src/users/application/types
 */
import type { UserRole } from '../../domain/types/role.types';
import type { McpTokenScope } from '../../domain/types/mcp-token.types';

/** Default token lifetime when the caller doesn't specify one. */
export const MCP_TOKEN_DEFAULT_EXPIRY_DAYS = 90;

/** Hard ceiling on token lifetime. */
export const MCP_TOKEN_MAX_EXPIRY_DAYS = 365;

/** Prefix on every raw MCP token — greppable by secret scanners. */
export const MCP_TOKEN_PREFIX = 'olmcp_';

export interface MintMcpTokenInput {
  userId: string;
  name: string;
  /** `mcp:write` implies `mcp:read`; the service stores both. */
  scope: McpTokenScope;
  /** Defaults to MCP_TOKEN_DEFAULT_EXPIRY_DAYS, clamped to the max. */
  expiresInDays?: number;
  /** RFC 8707 resource identifier this token is bound to. */
  resource: string;
}

/**
 * Result of minting. `rawToken` is the ONLY time the raw value exists
 * outside the client — it is never persisted and never re-derivable.
 */
export interface MintedMcpToken {
  id: string;
  rawToken: string;
  name: string;
  scopes: McpTokenScope[];
  /** The PERSISTED creation timestamp — never a re-derived `new Date()`. */
  createdAt: Date;
  expiresAt: Date;
  /** RFC 8707 resource this token was bound to at mint time. */
  resource: string;
}

/**
 * Operator-facing view of a token. Deliberately carries neither the raw
 * value nor the hash.
 */
export interface McpTokenSummary {
  id: string;
  userId: string;
  name: string;
  scopes: McpTokenScope[];
  /** RFC 8707 resource this token was bound to at mint time. */
  resource: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  isActive: boolean;
}

/**
 * Neutral principal resolved from a presented raw token.
 *
 * This is the seam between core and the MCP Interface layer: core answers
 * "is this token valid and whose is it"; the verifier maps the answer onto
 * the SDK's `AuthInfo`. Note there is deliberately no raw-token field here.
 */
export interface McpPrincipal {
  tokenId: string;
  tokenName: string;
  userId: string;
  role: UserRole;
  scopes: McpTokenScope[];
  expiresAt: Date;
  resource: string;
}
