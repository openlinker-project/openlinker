/**
 * OlMcpTokenVerifier Unit Tests — the security core of #1486.
 *
 * Asserts the thrown `OAuthError` CODE rather than an HTTP status: mapping
 * a code to 401/403 plus the `WWW-Authenticate` challenge is the SDK's job
 * (`requireBearerAuth`), and is asserted end-to-end in the int-spec.
 *
 * Also asserts the §3.6.1 leak invariant: `AuthInfo` carries the RAW bearer
 * token, so nothing here may log it.
 */
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import type { IMcpTokenService, McpPrincipal } from '@openlinker/core/users';
import { OlMcpTokenVerifier } from './ol-mcp-token.verifier';

const RESOURCE = 'https://ol.example.com/mcp';
const RAW_TOKEN = 'olmcp_super-secret-raw-value';

function buildPrincipal(overrides: Partial<McpPrincipal> = {}): McpPrincipal {
  return {
    tokenId: 'token-1',
    tokenName: 'Claude Desktop',
    userId: 'user-1',
    role: 'admin',
    scopes: ['mcp:read'],
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    resource: RESOURCE,
    ...overrides,
  };
}

describe('OlMcpTokenVerifier', () => {
  let mcpTokens: jest.Mocked<IMcpTokenService>;
  let verifier: OlMcpTokenVerifier;

  beforeEach(() => {
    process.env.OL_MCP_RESOURCE_URL = RESOURCE;
    mcpTokens = {
      mint: jest.fn(),
      list: jest.fn(),
      revoke: jest.fn(),
      resolvePrincipal: jest.fn(),
    } as unknown as jest.Mocked<IMcpTokenService>;
    verifier = new OlMcpTokenVerifier(mcpTokens);
  });

  afterEach(() => {
    delete process.env.OL_MCP_RESOURCE_URL;
    jest.restoreAllMocks();
  });

  describe('verifyAccessToken (accepted)', () => {
    it('should return AuthInfo for a valid read-scoped token', async () => {
      mcpTokens.resolvePrincipal.mockResolvedValue(buildPrincipal());

      const authInfo = await verifier.verifyAccessToken(RAW_TOKEN);

      expect(authInfo.scopes).toEqual(['mcp:read']);
      expect(authInfo.clientId).toBe('token-1');
    });

    it('should return both scopes for a write-scoped token', async () => {
      mcpTokens.resolvePrincipal.mockResolvedValue(
        buildPrincipal({ scopes: ['mcp:read', 'mcp:write'] })
      );

      const authInfo = await verifier.verifyAccessToken(RAW_TOKEN);

      expect(authInfo.scopes).toEqual(['mcp:read', 'mcp:write']);
    });

    it('should always populate expiresAt in epoch seconds', async () => {
      const expiresAt = new Date('2099-01-01T00:00:00.000Z');
      mcpTokens.resolvePrincipal.mockResolvedValue(buildPrincipal({ expiresAt }));

      const authInfo = await verifier.verifyAccessToken(RAW_TOKEN);

      // The SDK REJECTS an AuthInfo whose expiresAt is unset.
      expect(authInfo.expiresAt).toBe(Math.floor(expiresAt.getTime() / 1000));
    });

    it('should carry the OpenLinker principal in extra', async () => {
      mcpTokens.resolvePrincipal.mockResolvedValue(buildPrincipal());

      const authInfo = await verifier.verifyAccessToken(RAW_TOKEN);

      expect(authInfo.extra).toEqual({
        mcpTokenId: 'token-1',
        tokenName: 'Claude Desktop',
        olUserId: 'user-1',
        olRole: 'admin',
      });
    });

    it('should inherit the owning user role rather than assuming admin', async () => {
      mcpTokens.resolvePrincipal.mockResolvedValue(buildPrincipal({ role: 'viewer' }));

      const authInfo = await verifier.verifyAccessToken(RAW_TOKEN);

      expect((authInfo.extra as { olRole: string }).olRole).toBe('viewer');
    });
  });

  describe('verifyAccessToken (rejected)', () => {
    // resolvePrincipal returns null for every invalid shape — unknown,
    // revoked, expired, deleted owner, deactivated owner — so they all
    // answer identically and cannot be used as an oracle.
    it.each([
      ['an unknown token'],
      ['a revoked token'],
      ['an expired token'],
      ['a token whose owner was deleted'],
      ['a token whose owner is deactivated'],
    ])('should throw invalid_token for %s', async (_case) => {
      mcpTokens.resolvePrincipal.mockResolvedValue(null);

      await expect(verifier.verifyAccessToken(RAW_TOKEN)).rejects.toMatchObject({
        code: OAuthErrorCode.InvalidToken,
      });
    });

    it('should throw invalid_token for a non-OpenLinker passthrough token', async () => {
      mcpTokens.resolvePrincipal.mockResolvedValue(null);

      await expect(verifier.verifyAccessToken('github_pat_abc123')).rejects.toBeInstanceOf(
        OAuthError
      );
    });

    it('should throw invalid_token when the token is bound to another resource', async () => {
      mcpTokens.resolvePrincipal.mockResolvedValue(
        buildPrincipal({ resource: 'https://someone-else.example.com/mcp' })
      );

      await expect(verifier.verifyAccessToken(RAW_TOKEN)).rejects.toMatchObject({
        code: OAuthErrorCode.InvalidToken,
      });
    });

    it('should throw invalid_token for a malformed empty token', async () => {
      mcpTokens.resolvePrincipal.mockResolvedValue(null);

      await expect(verifier.verifyAccessToken('')).rejects.toBeInstanceOf(OAuthError);
    });
  });

  describe('raw-token leak invariant (plan §3.6.1)', () => {
    it('should not log the raw token on the accepted path', async () => {
      const logSpy = jest.spyOn(
        Object.getPrototypeOf(verifier['logger']) as { log: (m: string) => void },
        'log'
      );
      const warnSpy = jest.spyOn(
        Object.getPrototypeOf(verifier['logger']) as { warn: (m: string) => void },
        'warn'
      );
      mcpTokens.resolvePrincipal.mockResolvedValue(buildPrincipal());

      await verifier.verifyAccessToken(RAW_TOKEN);

      for (const spy of [logSpy, warnSpy]) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(RAW_TOKEN);
        }
      }
    });

    it('should not log the raw token when rejecting on a resource mismatch', async () => {
      const warnSpy = jest.spyOn(
        Object.getPrototypeOf(verifier['logger']) as { warn: (m: string) => void },
        'warn'
      );
      mcpTokens.resolvePrincipal.mockResolvedValue(
        buildPrincipal({ resource: 'https://elsewhere.example.com/mcp' })
      );

      await expect(verifier.verifyAccessToken(RAW_TOKEN)).rejects.toBeInstanceOf(OAuthError);

      expect(warnSpy).toHaveBeenCalled();
      for (const call of warnSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(RAW_TOKEN);
      }
    });

    it('should not leak the raw token in the thrown error message', async () => {
      mcpTokens.resolvePrincipal.mockResolvedValue(null);

      await expect(verifier.verifyAccessToken(RAW_TOKEN)).rejects.toThrow(
        expect.not.stringContaining(RAW_TOKEN) as unknown as string
      );
    });
  });
});
