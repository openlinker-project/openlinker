/**
 * `whoami` MCP Tool
 *
 * Returns the OpenLinker identity backing the presented MCP token.
 *
 * Shipped inline in `mcp-server.factory.ts` by Phase 0 (#1486) as the auth
 * proof, with a standing note that it belonged in a `*.tool.ts` file once
 * #1487 registered that convention. This file discharges that note — and,
 * more importantly, puts `whoami` behind the registry's per-call wrapper
 * (rate limit + audit) like every other tool.
 *
 * Always registered: it is a discovery entry point and must work on a
 * deployment with no connections at all.
 *
 * SECURITY: returns only the redacted principal projection — never the
 * `AuthInfo`, which carries the raw bearer token.
 *
 * @module apps/api/src/mcp/tools/read
 */
import * as z from 'zod/v4';
import type { CallToolResult, McpRequestContext } from '@modelcontextprotocol/server';

import { isMcpAuthInfoExtra } from '../../auth/mcp-principal.types';
import type { McpToolDefinition } from '../tool-definition.types';
import { jsonResult, toolFailure } from './tool-result';

export function createWhoamiTool(): McpToolDefinition {
  return {
    name: 'whoami',
    requiredCapability: null,
    requiredScope: 'mcp:read',
    requiresAdmin: false,
    description:
      'Return the OpenLinker identity backing the presented MCP token (user id, role, token name, granted scopes). Use this to verify a token is installed and working.',
    inputSchema: z.object({}),
    handler: (_args: Record<string, unknown>, ctx: McpRequestContext): Promise<CallToolResult> => {
      const extra = ctx.authInfo?.extra;
      if (!isMcpAuthInfoExtra(extra)) {
        return Promise.resolve(toolFailure('No OpenLinker principal on this request.'));
      }
      return Promise.resolve(
        jsonResult({
          userId: extra.olUserId,
          role: extra.olRole,
          tokenName: extra.tokenName,
          scopes: ctx.authInfo?.scopes ?? [],
        })
      );
    },
  };
}
