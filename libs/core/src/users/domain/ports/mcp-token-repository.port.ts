/**
 * MCP Token Repository Port
 *
 * Persistence contract for OpenLinker-issued MCP Personal Access Tokens
 * (#1486). Implemented by McpTokenRepository in the infrastructure layer.
 *
 * The port speaks domain entities only. It is deliberately minimal — the
 * mint / list / revoke / verify flows in `McpTokenService` are the only
 * consumers, and this is an intra-context contract (cross-context callers
 * go through `IMcpTokenService`).
 *
 * @module libs/core/src/users/domain/ports
 */
import type { McpToken } from '../entities/mcp-token.entity';
import type { McpTokenRevocationReason } from '../types/mcp-token.types';

export interface McpTokenRepositoryPort {
  /** Insert a freshly-minted token row. */
  insert(token: McpToken): Promise<McpToken>;

  /** Look up by SHA-256 hash. Returns null if no row matches. */
  findByHash(tokenHash: string): Promise<McpToken | null>;

  /** Look up by id. Returns null if no row matches. */
  findById(id: string): Promise<McpToken | null>;

  /**
   * List tokens, newest first. Omitting `userId` lists every token
   * (single-tenant admin surface).
   */
  findMany(userId?: string): Promise<McpToken[]>;

  /**
   * Mark a token revoked. Idempotent — an already-revoked row is a no-op.
   */
  revoke(id: string, reason: McpTokenRevocationReason, at?: Date): Promise<void>;

  /**
   * Stamp `last_used_at`. Best-effort telemetry on the verification hot
   * path — callers must not let a failure here fail the request.
   */
  touchLastUsed(id: string, at?: Date): Promise<void>;
}
