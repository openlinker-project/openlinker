/**
 * MCP Token Domain Entity
 *
 * Server-side record of an OpenLinker-issued MCP Personal Access Token
 * (#1486, ADR-034). The raw token is never persisted — only its SHA-256
 * hash, mirroring the `RefreshToken` precedent.
 *
 * `expiresAt` is NON-NULLABLE by design: the MCP SDK's bearer verification
 * rejects any `AuthInfo` whose `expiresAt` is unset, so a "never expires"
 * token could never authenticate. Mandatory expiry is therefore a hard
 * constraint, not a policy preference.
 *
 * @module libs/core/src/users/domain/entities
 */
import type { McpTokenRevocationReason, McpTokenScope } from '../types/mcp-token.types';

export class McpToken {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly name: string,
    public readonly tokenHash: string,
    public readonly scopes: readonly McpTokenScope[],
    /** RFC 8707 resource identifier this token is valid for. */
    public readonly resource: string,
    public readonly createdAt: Date,
    public readonly expiresAt: Date,
    public readonly lastUsedAt: Date | null,
    public readonly revokedAt: Date | null,
    public readonly revokedReason: McpTokenRevocationReason | null
  ) {}

  isRevoked(): boolean {
    return this.revokedAt !== null;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  /** Pure function of this entity's own fields — no I/O, no mutation (ADR-011). */
  isActive(now: Date = new Date()): boolean {
    return !this.isRevoked() && !this.isExpired(now);
  }

  hasScope(scope: McpTokenScope): boolean {
    return this.scopes.includes(scope);
  }
}
