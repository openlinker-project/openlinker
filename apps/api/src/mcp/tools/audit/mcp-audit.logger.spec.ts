/**
 * McpAuditLogger Unit Tests
 *
 * Re-asserts the #1486 redaction invariant at its new #1487 consumer: the
 * audit line must carry the redacted principal projection and never anything
 * derived from the raw bearer token.
 */
import { Logger } from '@openlinker/shared/logging';

import { McpAuditLogger } from './mcp-audit.logger';
import type { RedactedMcpPrincipal } from '../../auth/mcp-principal.types';

const principal: RedactedMcpPrincipal = {
  mcpTokenId: 'tok-1',
  olUserId: 'user-1',
  olRole: 'admin',
  scopes: ['mcp:read'],
};

function captureLogger(): { logger: McpAuditLogger; lines: Array<[string, string]> } {
  const lines: Array<[string, string]> = [];
  const logger = new McpAuditLogger();
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      lines.push([level, String(args[0])]);
    });
  }
  return { logger, lines };
}

describe('McpAuditLogger', () => {
  afterEach(() => jest.restoreAllMocks());

  it('should record the redacted principal fields', () => {
    const { logger, lines } = captureLogger();

    logger.record({ tool: 'get_product', outcome: 'ok', durationMs: 12, principal });

    const [, message] = lines[0];
    expect(JSON.parse(message)).toEqual(
      expect.objectContaining({
        tool: 'get_product',
        outcome: 'ok',
        durationMs: 12,
        mcpTokenId: 'tok-1',
        olUserId: 'user-1',
        olRole: 'admin',
      })
    );
  });

  it('should never emit a token field even if one is smuggled into the principal', () => {
    const { logger, lines } = captureLogger();

    logger.record({
      tool: 'get_product',
      outcome: 'ok',
      durationMs: 1,
      // A future refactor handing the wrong object in must not leak: the
      // logger copies named fields rather than spreading the principal.
      principal: { ...principal, token: 'olmcp_secret' } as unknown as RedactedMcpPrincipal,
    });

    expect(lines[0][1]).not.toContain('olmcp_secret');
    expect(lines[0][1]).not.toContain('token');
  });

  it('should log an absent principal loudly, since the transport fails closed', () => {
    const { logger, lines } = captureLogger();

    logger.record({ tool: 'get_product', outcome: 'error', durationMs: 1, principal: null });

    const [level, message] = lines[0];
    expect(level).toBe('error');
    expect(message).toContain('"principal":"none"');
  });

  it('should log a failed call at warn and a healthy one at log', () => {
    const { logger, lines } = captureLogger();

    logger.record({ tool: 't', outcome: 'error', durationMs: 1, principal, detail: 'boom' });
    logger.record({ tool: 't', outcome: 'ok', durationMs: 1, principal });

    expect(lines[0][0]).toBe('warn');
    expect(lines[0][1]).toContain('boom');
    expect(lines[1][0]).toBe('log');
  });

  it('should include connectionId only for tools that take one', () => {
    const { logger, lines } = captureLogger();

    logger.record({ tool: 'get_availability', outcome: 'ok', durationMs: 1, principal });
    logger.record({
      tool: 'search_catalog',
      outcome: 'ok',
      durationMs: 1,
      connectionId: 'conn-9',
      principal,
    });

    expect(lines[0][1]).not.toContain('connectionId');
    expect(lines[1][1]).toContain('conn-9');
  });
});
