/**
 * McpTokensController Unit Tests
 *
 * Role enforcement itself is the global `RolesGuard`'s job; these tests
 * cover the controller's own contract — notably that the raw token appears
 * on create and nowhere else.
 */
import { NotFoundException } from '@nestjs/common';
import type { IMcpTokenService, McpTokenSummary } from '@openlinker/core/users';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { McpTokensController } from './mcp-tokens.controller';

const ADMIN: AuthenticatedUser = { id: 'user-1', username: 'admin', role: 'admin' };

function buildSummary(overrides: Partial<McpTokenSummary> = {}): McpTokenSummary {
  return {
    id: 'token-1',
    userId: 'user-1',
    name: 'Claude Desktop',
    scopes: ['mcp:read'],
    resource: 'http://localhost:3000/mcp',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    lastUsedAt: null,
    revokedAt: null,
    isActive: true,
    ...overrides,
  };
}

describe('McpTokensController', () => {
  let mcpTokens: jest.Mocked<IMcpTokenService>;
  let controller: McpTokensController;

  beforeEach(() => {
    mcpTokens = {
      mint: jest.fn(),
      list: jest.fn(),
      revoke: jest.fn(),
      resolvePrincipal: jest.fn(),
    } as unknown as jest.Mocked<IMcpTokenService>;
    controller = new McpTokensController(mcpTokens);
  });

  describe('create', () => {
    it('should return the raw token exactly once on create', async () => {
      mcpTokens.mint.mockResolvedValue({
        id: 'token-1',
        rawToken: 'olmcp_raw-value',
        name: 'Claude Desktop',
        scopes: ['mcp:read'],
        resource: 'http://localhost:3000/mcp',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      });

      const response = await controller.create(
        { name: 'Claude Desktop', scope: 'mcp:read' },
        ADMIN
      );

      expect(response.rawToken).toBe('olmcp_raw-value');
      // Reported from the persisted row, not a re-derived `new Date()`.
      expect(response.createdAt).toBe('2026-07-01T00:00:00.000Z');
    });

    it('should mint against the calling user', async () => {
      mcpTokens.mint.mockResolvedValue({
        id: 'token-1',
        rawToken: 'olmcp_x',
        name: 'n',
        scopes: ['mcp:read'],
        resource: 'http://localhost:3000/mcp',
        createdAt: new Date(),
        expiresAt: new Date(),
      });

      await controller.create({ name: 'n', scope: 'mcp:read' }, ADMIN);

      expect(mcpTokens.mint).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', name: 'n', scope: 'mcp:read' })
      );
    });
  });

  describe('list', () => {
    it('should never include a raw token or hash in the listing', async () => {
      mcpTokens.list.mockResolvedValue([buildSummary()]);

      const response = await controller.list();

      // The listing is deployment-wide, so every row must be attributable.
      expect(response[0].userId).toBe('user-1');
      expect(response[0]).not.toHaveProperty('rawToken');
      expect(response[0]).not.toHaveProperty('tokenHash');
    });

    it('should serialise dates as ISO strings', async () => {
      mcpTokens.list.mockResolvedValue([
        buildSummary({ lastUsedAt: new Date('2026-07-20T10:00:00.000Z') }),
      ]);

      const response = await controller.list();

      expect(response[0].createdAt).toBe('2026-07-01T00:00:00.000Z');
      expect(response[0].lastUsedAt).toBe('2026-07-20T10:00:00.000Z');
    });

    it('should flag a token bound to a stale resource URL', async () => {
      mcpTokens.list.mockResolvedValue([
        buildSummary({ resource: 'https://old-host.example.com/mcp' }),
      ]);

      const response = await controller.list();

      expect(response[0].resourceMatchesCurrent).toBe(false);
      expect(response[0].resource).toBe('https://old-host.example.com/mcp');
    });

    it('should not flag a token bound to the current resource URL', async () => {
      mcpTokens.list.mockResolvedValue([buildSummary()]);

      const response = await controller.list();

      expect(response[0].resourceMatchesCurrent).toBe(true);
    });

    it('should render a never-used token as null rather than a date', async () => {
      mcpTokens.list.mockResolvedValue([buildSummary({ lastUsedAt: null })]);

      const response = await controller.list();

      expect(response[0].lastUsedAt).toBeNull();
    });
  });

  describe('revoke', () => {
    it('should revoke an existing token', async () => {
      mcpTokens.revoke.mockResolvedValue(true);

      await expect(controller.revoke('token-1')).resolves.toBeUndefined();
      expect(mcpTokens.revoke).toHaveBeenCalledWith('token-1', 'revoked_by_admin');
    });

    it('should throw NotFound when the token does not exist', async () => {
      mcpTokens.revoke.mockResolvedValue(false);

      await expect(controller.revoke('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
