/**
 * MCP Token Service
 *
 * Mints, lists, revokes, and verifies OpenLinker-issued MCP Personal Access
 * Tokens (#1486, ADR-034).
 *
 * Lives in `libs/core` rather than alongside its three sibling token
 * services in `apps/api/src/auth/` because a service outside this context
 * may not inject `McpTokenRepositoryPort` — repository ports are
 * intra-context (`scripts/check-cross-context-imports.mjs`). The siblings
 * pass only via that checker's grandfathered ALLOW_LIST (#722), which
 * greenfield code must not grow.
 *
 * Token format: an opaque `olmcp_`-prefixed 256-bit CSPRNG draw, stored as
 * a SHA-256 hash. Opaque over JWT so revocation is immediate and total; the
 * per-call cost is one indexed unique-hash lookup.
 *
 * @module libs/core/src/users/application/services
 * @implements {IMcpTokenService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Logger } from '@openlinker/shared/logging';
import { McpToken } from '../../domain/entities/mcp-token.entity';
import { McpTokenRepositoryPort } from '../../domain/ports/mcp-token-repository.port';
import { UserRepositoryPort } from '../../domain/ports/user-repository.port';
import type {
  McpTokenRevocationReason,
  McpTokenScope,
} from '../../domain/types/mcp-token.types';
import { MCP_TOKEN_REPOSITORY_TOKEN, USER_REPOSITORY_TOKEN } from '../../users.tokens';
import type { IMcpTokenService } from './mcp-token.service.interface';
import {
  MCP_TOKEN_DEFAULT_EXPIRY_DAYS,
  MCP_TOKEN_MAX_EXPIRY_DAYS,
  MCP_TOKEN_PREFIX,
  type McpPrincipal,
  type McpTokenSummary,
  type MintMcpTokenInput,
  type MintedMcpToken,
} from '../types/mcp-token.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Minimum age before `last_used_at` is re-stamped. Verification runs on EVERY
 * MCP request, so an unconditional write would mean one DB write per tool call
 * once #1487's tool surface lands — pure write amplification for a coarse
 * "recently used" signal. 5 minutes keeps the operator-facing value useful
 * while collapsing a burst of calls into a single write.
 */
const LAST_USED_STAMP_INTERVAL_MS = 5 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** `mcp:write` implies `mcp:read` — both are stored so the SDK's plain
 * `requiredScopes` superset check needs no implication logic. */
function expandScopes(scope: McpTokenScope): McpTokenScope[] {
  return scope === 'mcp:write' ? ['mcp:read', 'mcp:write'] : ['mcp:read'];
}

@Injectable()
export class McpTokenService implements IMcpTokenService {
  private readonly logger = new Logger(McpTokenService.name);

  constructor(
    @Inject(MCP_TOKEN_REPOSITORY_TOKEN)
    private readonly repository: McpTokenRepositoryPort,
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly users: UserRepositoryPort
  ) {}

  async mint(input: MintMcpTokenInput): Promise<MintedMcpToken> {
    const days = Math.min(
      Math.max(input.expiresInDays ?? MCP_TOKEN_DEFAULT_EXPIRY_DAYS, 1),
      MCP_TOKEN_MAX_EXPIRY_DAYS
    );
    const rawToken = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * MS_PER_DAY);
    const scopes = expandScopes(input.scope);

    const token = new McpToken(
      randomUUID(),
      input.userId,
      input.name,
      hashToken(rawToken),
      scopes,
      input.resource,
      now,
      expiresAt,
      null,
      null,
      null
    );
    const persisted = await this.repository.insert(token);

    // Never log the raw value — only its identity.
    this.logger.log(
      `Minted MCP token: id=${token.id}, user=${input.userId}, scopes=${scopes.join(',')}`
    );

    return {
      id: persisted.id,
      rawToken,
      name: persisted.name,
      // From the persisted row: `created_at` is DB-defaulted
      // (`@CreateDateColumn`), so the local `now` above is NOT what landed.
      createdAt: persisted.createdAt,
      scopes,
      expiresAt: persisted.expiresAt,
      resource: persisted.resource,
    };
  }

  async list(userId?: string): Promise<McpTokenSummary[]> {
    const tokens = await this.repository.findMany(userId);
    const now = new Date();
    return tokens.map((token) => ({
      id: token.id,
      userId: token.userId,
      name: token.name,
      scopes: [...token.scopes],
      resource: token.resource,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      lastUsedAt: token.lastUsedAt,
      revokedAt: token.revokedAt,
      isActive: token.isActive(now),
    }));
  }

  async revoke(id: string, reason: McpTokenRevocationReason): Promise<boolean> {
    const existing = await this.repository.findById(id);
    if (!existing) return false;
    if (existing.isRevoked()) return true;
    await this.repository.revoke(id, reason);
    this.logger.log(`Revoked MCP token: id=${id}, reason=${reason}`);
    return true;
  }

  async resolvePrincipal(rawToken: string): Promise<McpPrincipal | null> {
    if (!rawToken || !rawToken.startsWith(MCP_TOKEN_PREFIX)) return null;

    const token = await this.repository.findByHash(hashToken(rawToken));
    if (!token || !token.isActive()) return null;

    // An orphaned token (owner deleted) can't reach here — the FK cascades —
    // but the lookup fails closed regardless, which also covers deactivation.
    const user = await this.users.findById(token.userId);
    if (!user || user.status !== 'active') return null;

    void this.touchLastUsedBestEffort(token);

    return {
      tokenId: token.id,
      tokenName: token.name,
      userId: user.id,
      role: user.role,
      scopes: [...token.scopes],
      expiresAt: token.expiresAt,
      resource: token.resource,
    };
  }

  /**
   * Telemetry only — a failure here must never fail an otherwise-valid
   * request, so it is logged and swallowed.
   *
   * Called fire-and-forget (`void`) so it never sits on the response path,
   * which means the write can also be LOST if the process exits mid-request.
   * Combined with the 5-minute debounce below, `last_used_at` is therefore a
   * coarse "recently used" signal and is **not authoritative** — do not build
   * anything (billing, audit, expiry decisions) on its exact value.
   */
  private async touchLastUsedBestEffort(token: McpToken, now: Date = new Date()): Promise<void> {
    const lastUsedAt = token.lastUsedAt;
    if (
      lastUsedAt !== null &&
      now.getTime() - lastUsedAt.getTime() < LAST_USED_STAMP_INTERVAL_MS
    ) {
      return;
    }
    try {
      await this.repository.touchLastUsed(token.id, now);
    } catch (error) {
      this.logger.warn(
        `Failed to stamp last_used_at for MCP token ${token.id}: ${(error as Error).message}`
      );
    }
  }
}
