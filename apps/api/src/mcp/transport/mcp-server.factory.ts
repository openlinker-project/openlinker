/**
 * MCP Server Factory
 *
 * Builds the per-request `McpServer` served over Streamable HTTP (#1486).
 *
 * Phase 0 ships exactly one tool — `whoami`. It is an AUTH PROOF, not a tool
 * surface: it is the only way to demonstrate end-to-end that
 * `requireBearerAuth` → `req.auth` → `ctx.authInfo` actually carries the
 * OpenLinker principal, which is the single contract #1487's domain tools
 * build on. All real tools, and the dynamic capability-declared
 * `tools/list`, are #1487.
 *
 * NOTE (verified against the shipped `.d.cts`): the principal arrives as
 * `McpRequestContext.authInfo` — NOT `ctx.http.authInfo`, which appears in
 * some of the SDK's own prose but is not the shape its types declare.
 *
 * `whoami` deliberately lives here rather than in a `*.tool.ts` file: #1487
 * owns registering that file-suffix convention in `engineering-standards.md`,
 * and pre-empting it here would fork the decision.
 *
 * SECURITY: `ctx.authInfo` is an `AuthInfo`, which carries the RAW bearer
 * token. `whoami` returns only the redacted `extra` projection — never the
 * token, hash, or any credential.
 *
 * @module apps/api/src/mcp/transport
 */
import { McpServer, type McpRequestContext } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { Logger } from '@openlinker/shared/logging';
import { isMcpAuthInfoExtra } from '../auth/mcp-principal.types';

const SERVER_NAME = 'openlinker';

const logger = new Logger('McpServerFactory');

export function createMcpServerFactory(version: string) {
  return (ctx: McpRequestContext): McpServer => {
    const server = new McpServer({ name: SERVER_NAME, version });

    server.registerTool(
      'whoami',
      {
        description:
          'Return the OpenLinker identity backing the presented MCP token. Useful for verifying that a token is installed and working.',
        inputSchema: z.object({}),
      },
      () => {
        const authInfo = ctx.authInfo;
        const extra = authInfo?.extra;

        if (!isMcpAuthInfoExtra(extra)) {
          // Unreachable in practice — requireBearerAuth gates this route, and
          // the transport controller fails closed before delegating. If it IS
          // reached, that is a security-relevant event (a request served with
          // no principal), so make it loud rather than a silent tool error.
          logger.error(
            'whoami invoked with no OpenLinker principal on the request — the bearer middleware may not be bound to this route.'
          );
          return {
            content: [{ type: 'text' as const, text: 'No OpenLinker principal on this request.' }],
            isError: true,
          };
        }

        // Redacted projection ONLY. Never `authInfo` itself.
        const identity = {
          userId: extra.olUserId,
          role: extra.olRole,
          tokenName: extra.tokenName,
          scopes: authInfo?.scopes ?? [],
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(identity, null, 2) }],
        };
      }
    );

    return server;
  };
}
