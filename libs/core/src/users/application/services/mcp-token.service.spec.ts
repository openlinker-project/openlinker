/**
 * McpTokenService Unit Tests
 *
 * Mocks the repository + user ports (never concrete classes).
 *
 * The security-critical assertions here are: the raw token is returned
 * exactly once and is not re-derivable from anything persisted, and
 * `resolvePrincipal` fails closed for every invalid-token shape.
 */
import { createHash } from 'node:crypto';
import { McpToken } from '../../domain/entities/mcp-token.entity';
import type { McpTokenRepositoryPort } from '../../domain/ports/mcp-token-repository.port';
import type { UserRepositoryPort } from '../../domain/ports/user-repository.port';
import { User } from '../../domain/entities/user.entity';
import { McpTokenService } from './mcp-token.service';
import { MCP_TOKEN_MAX_EXPIRY_DAYS, MCP_TOKEN_PREFIX } from '../types/mcp-token.types';

const RESOURCE = 'https://ol.example.com/mcp';

function buildActiveUser(overrides: Partial<{ status: string }> = {}): User {
  return new User(
    'user-1',
    'admin',
    'admin@example.com',
    'hash',
    'admin',
    (overrides.status ?? 'active') as User['status'],
    new Date(),
    new Date()
  );
}

function buildToken(overrides: Partial<McpToken> = {}): McpToken {
  return new McpToken(
    (overrides.id as string) ?? 'token-1',
    (overrides.userId as string) ?? 'user-1',
    (overrides.name as string) ?? 'Claude Desktop',
    (overrides.tokenHash as string) ?? 'hash',
    (overrides.scopes as McpToken['scopes']) ?? ['mcp:read'],
    (overrides.resource as string) ?? RESOURCE,
    new Date('2026-07-01T00:00:00.000Z'),
    (overrides.expiresAt as Date) ?? new Date('2099-01-01T00:00:00.000Z'),
    null,
    (overrides.revokedAt as Date | null) ?? null,
    null
  );
}

describe('McpTokenService', () => {
  let repository: jest.Mocked<McpTokenRepositoryPort>;
  let users: jest.Mocked<UserRepositoryPort>;
  let service: McpTokenService;

  beforeEach(() => {
    repository = {
      insert: jest.fn().mockImplementation((token: McpToken) => Promise.resolve(token)),
      findByHash: jest.fn(),
      findById: jest.fn(),
      findMany: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
      touchLastUsed: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<McpTokenRepositoryPort>;

    users = { findById: jest.fn() } as unknown as jest.Mocked<UserRepositoryPort>;

    service = new McpTokenService(repository, users);
  });

  describe('mint', () => {
    it('should return a prefixed raw token and persist only its hash', async () => {
      const result = await service.mint({
        userId: 'user-1',
        name: 'Claude Desktop',
        scope: 'mcp:read',
        resource: RESOURCE,
      });

      expect(result.rawToken.startsWith(MCP_TOKEN_PREFIX)).toBe(true);

      const persisted = repository.insert.mock.calls[0][0];
      expect(persisted.tokenHash).toBe(
        createHash('sha256').update(result.rawToken).digest('hex')
      );
      // The raw value must not be recoverable from anything stored.
      expect(JSON.stringify(persisted)).not.toContain(result.rawToken);
    });

    it('should produce a distinct raw token on every mint', async () => {
      const first = await service.mint({
        userId: 'user-1',
        name: 'a',
        scope: 'mcp:read',
        resource: RESOURCE,
      });
      const second = await service.mint({
        userId: 'user-1',
        name: 'b',
        scope: 'mcp:read',
        resource: RESOURCE,
      });
      expect(first.rawToken).not.toBe(second.rawToken);
    });

    it('should store both scopes when write is requested', async () => {
      const result = await service.mint({
        userId: 'user-1',
        name: 'w',
        scope: 'mcp:write',
        resource: RESOURCE,
      });
      expect(result.scopes).toEqual(['mcp:read', 'mcp:write']);
    });

    it('should store only read when read is requested', async () => {
      const result = await service.mint({
        userId: 'user-1',
        name: 'r',
        scope: 'mcp:read',
        resource: RESOURCE,
      });
      expect(result.scopes).toEqual(['mcp:read']);
    });

    it('should default expiry to 90 days when unspecified', async () => {
      const before = Date.now();
      const result = await service.mint({
        userId: 'user-1',
        name: 'd',
        scope: 'mcp:read',
        resource: RESOURCE,
      });
      const days = Math.round((result.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000));
      expect(days).toBe(90);
    });

    it('should clamp expiry to the documented maximum', async () => {
      const before = Date.now();
      const result = await service.mint({
        userId: 'user-1',
        name: 'c',
        scope: 'mcp:read',
        expiresInDays: 100_000,
        resource: RESOURCE,
      });
      const days = Math.round((result.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000));
      expect(days).toBe(MCP_TOKEN_MAX_EXPIRY_DAYS);
    });

    it('should return the PERSISTED createdAt rather than a re-derived date', async () => {
      const persistedAt = new Date('2026-07-01T00:00:00.000Z');
      repository.insert.mockImplementation((token: McpToken) =>
        Promise.resolve(
          new McpToken(
            token.id,
            token.userId,
            token.name,
            token.tokenHash,
            token.scopes,
            token.resource,
            persistedAt,
            token.expiresAt,
            null,
            null,
            null
          )
        )
      );

      const result = await service.mint({
        userId: 'user-1',
        name: 'p',
        scope: 'mcp:read',
        resource: RESOURCE,
      });

      expect(result.createdAt).toEqual(persistedAt);
      expect(result.resource).toBe(RESOURCE);
    });

    it('should always set an expiry (the MCP SDK rejects an unset expiresAt)', async () => {
      const result = await service.mint({
        userId: 'user-1',
        name: 'e',
        scope: 'mcp:read',
        resource: RESOURCE,
      });
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('list', () => {
    it('should never expose the raw token or its hash', async () => {
      repository.findMany.mockResolvedValue([buildToken({ tokenHash: 'super-secret-hash' })]);

      const summaries = await service.list();

      expect(JSON.stringify(summaries)).not.toContain('super-secret-hash');
      expect(summaries[0]).not.toHaveProperty('tokenHash');
      expect(summaries[0]).not.toHaveProperty('rawToken');
    });
  });

  describe('revoke', () => {
    it('should return false when the token does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      expect(await service.revoke('missing', 'revoked_by_admin')).toBe(false);
      expect(repository.revoke).not.toHaveBeenCalled();
    });

    it('should be idempotent for an already-revoked token', async () => {
      repository.findById.mockResolvedValue(buildToken({ revokedAt: new Date() }));
      expect(await service.revoke('token-1', 'revoked_by_admin')).toBe(true);
      expect(repository.revoke).not.toHaveBeenCalled();
    });

    it('should revoke an active token', async () => {
      repository.findById.mockResolvedValue(buildToken());
      expect(await service.revoke('token-1', 'revoked_by_admin')).toBe(true);
      expect(repository.revoke).toHaveBeenCalledWith('token-1', 'revoked_by_admin');
    });
  });

  describe('resolvePrincipal', () => {
    it('should resolve an active token to its owner and inherit the role', async () => {
      repository.findByHash.mockResolvedValue(buildToken());
      users.findById.mockResolvedValue(buildActiveUser());

      const principal = await service.resolvePrincipal(`${MCP_TOKEN_PREFIX}abc`);

      expect(principal).not.toBeNull();
      expect(principal?.userId).toBe('user-1');
      expect(principal?.role).toBe('admin');
      expect(principal?.scopes).toEqual(['mcp:read']);
    });

    it('should never place a raw token on the principal', async () => {
      repository.findByHash.mockResolvedValue(buildToken());
      users.findById.mockResolvedValue(buildActiveUser());

      const raw = `${MCP_TOKEN_PREFIX}sensitive-value`;
      const principal = await service.resolvePrincipal(raw);

      expect(JSON.stringify(principal)).not.toContain('sensitive-value');
    });

    it('should return null for a token without the OpenLinker prefix', async () => {
      expect(await service.resolvePrincipal('github_pat_something')).toBeNull();
      expect(repository.findByHash).not.toHaveBeenCalled();
    });

    it('should return null for an unknown token', async () => {
      repository.findByHash.mockResolvedValue(null);
      expect(await service.resolvePrincipal(`${MCP_TOKEN_PREFIX}x`)).toBeNull();
    });

    it('should return null for a revoked token', async () => {
      repository.findByHash.mockResolvedValue(buildToken({ revokedAt: new Date('2026-01-01') }));
      expect(await service.resolvePrincipal(`${MCP_TOKEN_PREFIX}x`)).toBeNull();
    });

    it('should return null for an expired token', async () => {
      repository.findByHash.mockResolvedValue(
        buildToken({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })
      );
      expect(await service.resolvePrincipal(`${MCP_TOKEN_PREFIX}x`)).toBeNull();
    });

    it('should return null when the owning user was deleted (orphan token)', async () => {
      repository.findByHash.mockResolvedValue(buildToken());
      users.findById.mockResolvedValue(null);
      expect(await service.resolvePrincipal(`${MCP_TOKEN_PREFIX}x`)).toBeNull();
    });

    it('should return null when the owning user is deactivated', async () => {
      repository.findByHash.mockResolvedValue(buildToken());
      users.findById.mockResolvedValue(buildActiveUser({ status: 'deactivated' }));
      expect(await service.resolvePrincipal(`${MCP_TOKEN_PREFIX}x`)).toBeNull();
    });

    it('should stamp last-used when it has never been stamped', async () => {
      repository.findByHash.mockResolvedValue(buildToken());
      users.findById.mockResolvedValue(buildActiveUser());

      await service.resolvePrincipal(`${MCP_TOKEN_PREFIX}x`);
      await new Promise((resolve) => setImmediate(resolve));

      expect(repository.touchLastUsed).toHaveBeenCalled();
    });

    it('should SKIP the last-used write when stamped recently (write amplification)', async () => {
      // Verification runs on every MCP request; an unconditional write would be
      // one DB write per tool call once #1487 lands.
      const token = buildToken();
      const recent = new McpToken(
        token.id,
        token.userId,
        token.name,
        token.tokenHash,
        token.scopes,
        token.resource,
        token.createdAt,
        token.expiresAt,
        new Date(),
        null,
        null
      );
      repository.findByHash.mockResolvedValue(recent);
      users.findById.mockResolvedValue(buildActiveUser());

      await service.resolvePrincipal(`${MCP_TOKEN_PREFIX}x`);
      await new Promise((resolve) => setImmediate(resolve));

      expect(repository.touchLastUsed).not.toHaveBeenCalled();
    });

    it('should not fail the request when the last-used stamp fails', async () => {
      repository.findByHash.mockResolvedValue(buildToken());
      users.findById.mockResolvedValue(buildActiveUser());
      repository.touchLastUsed.mockRejectedValue(new Error('db down'));

      await expect(service.resolvePrincipal(`${MCP_TOKEN_PREFIX}x`)).resolves.not.toBeNull();
    });
  });
});
