/**
 * McpToken Entity Unit Tests
 *
 * Covers the pure read-only derivations (ADR-011) — no I/O, no mocks.
 */
import { McpToken } from './mcp-token.entity';
import type { McpTokenRevocationReason, McpTokenScope } from '../types/mcp-token.types';

const NOW = new Date('2026-07-28T12:00:00.000Z');

function buildToken(
  overrides: {
    expiresAt?: Date;
    revokedAt?: Date | null;
    revokedReason?: McpTokenRevocationReason | null;
    scopes?: McpTokenScope[];
  } = {}
): McpToken {
  return new McpToken(
    'token-1',
    'user-1',
    'Claude Desktop',
    'a'.repeat(64),
    overrides.scopes ?? ['mcp:read'],
    'https://ol.example.com/mcp',
    new Date('2026-07-01T00:00:00.000Z'),
    overrides.expiresAt ?? new Date('2026-12-31T00:00:00.000Z'),
    null,
    overrides.revokedAt ?? null,
    overrides.revokedReason ?? null
  );
}

describe('McpToken', () => {
  describe('isActive', () => {
    it('should be active when neither revoked nor expired', () => {
      expect(buildToken().isActive(NOW)).toBe(true);
    });

    it('should not be active when expired', () => {
      const token = buildToken({ expiresAt: new Date('2026-07-01T00:00:00.000Z') });
      expect(token.isActive(NOW)).toBe(false);
      expect(token.isExpired(NOW)).toBe(true);
    });

    it('should not be active when revoked', () => {
      const token = buildToken({
        revokedAt: new Date('2026-07-20T00:00:00.000Z'),
        revokedReason: 'revoked_by_admin',
      });
      expect(token.isActive(NOW)).toBe(false);
      expect(token.isRevoked()).toBe(true);
    });

    it('should treat an expiry exactly at now as expired', () => {
      expect(buildToken({ expiresAt: NOW }).isActive(NOW)).toBe(false);
    });
  });

  describe('hasScope', () => {
    it('should report granted scopes', () => {
      const token = buildToken({ scopes: ['mcp:read', 'mcp:write'] });
      expect(token.hasScope('mcp:read')).toBe(true);
      expect(token.hasScope('mcp:write')).toBe(true);
    });

    it('should not report a scope that was never granted', () => {
      expect(buildToken({ scopes: ['mcp:read'] }).hasScope('mcp:write')).toBe(false);
    });
  });
});
