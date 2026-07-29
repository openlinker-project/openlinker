/**
 * MCP Token Service Interface
 *
 * Contract for minting, listing, revoking, and verifying OpenLinker-issued
 * MCP Personal Access Tokens (#1486, ADR-034).
 *
 * This interface is the cross-context seam: `apps/api/src/mcp/` consumes it
 * via `MCP_TOKEN_SERVICE_TOKEN` and never touches `McpTokenRepositoryPort`
 * (repository ports are intra-context — see
 * `scripts/check-cross-context-imports.mjs`).
 *
 * @module libs/core/src/users/application/services
 */
import type {
  McpPrincipal,
  McpTokenSummary,
  MintMcpTokenInput,
  MintedMcpToken,
} from '../types/mcp-token.types';
import type { McpTokenRevocationReason } from '../../domain/types/mcp-token.types';

export interface IMcpTokenService {
  /**
   * Mint a new token. The returned `rawToken` is the only time the raw
   * value is available — it is stored hashed and never re-derivable.
   */
  mint(input: MintMcpTokenInput): Promise<MintedMcpToken>;

  /**
   * List tokens, newest first. Never returns the raw value or the hash.
   * Omitting `userId` lists every token (single-tenant admin surface).
   */
  list(userId?: string): Promise<McpTokenSummary[]>;

  /** Revoke a token. Idempotent. Returns false when no such token exists. */
  revoke(id: string, reason: McpTokenRevocationReason): Promise<boolean>;

  /**
   * Resolve a presented raw token to its owning principal.
   *
   * Returns `null` — never throws — when the token is unknown, revoked,
   * expired, or its owner is missing/inactive. The Interface layer decides
   * the protocol-level failure shape from that null.
   */
  resolvePrincipal(rawToken: string): Promise<McpPrincipal | null>;
}
