/**
 * MCP Server Factory
 *
 * Builds the per-request `McpServer` served over Streamable HTTP (#1486),
 * now registry-driven (#1487).
 *
 * Phase 0 hard-coded a single `whoami` tool here as the auth proof, with a
 * standing note that it belonged in a `*.tool.ts` file once #1487 registered
 * that convention. It now lives at `tools/read/whoami.tool.ts` and is
 * registered through the same path as every other tool — which also puts it
 * behind the registry's per-call rate-limit + audit wrapper.
 *
 * `createMcpHandler` builds a FRESH server per HTTP request, so the tool list
 * is recomputed from live capability state on every `tools/list`. It therefore
 * cannot go stale, which is why `notifications/tools/list_changed` is neither
 * advertised nor sent — there is no long-lived session to push over, and no
 * staleness to correct. See ADR-033.
 *
 * NOTE (verified against the shipped `.d.cts`): the principal arrives as
 * `McpRequestContext.authInfo` — NOT `ctx.http.authInfo`, which appears in
 * some of the SDK's own prose but is not the shape its types declare.
 *
 * Critically, the principal lives on THIS request-scoped context only. The
 * context the SDK hands a tool callback at dispatch time does NOT carry
 * `authInfo`, so tools must close over the value threaded from here — proven
 * by `mcp-tools.int-spec.ts`, which fails with "No OpenLinker principal on
 * this request" if a tool reads the dispatch-time context instead.
 *
 * @module apps/api/src/mcp/transport
 */
import { McpServer, type McpRequestContext } from '@modelcontextprotocol/server';

import type { IMcpToolRegistryService } from '../tools/tool-registry.service.interface';

const SERVER_NAME = 'openlinker';

/**
 * Returns an async factory. The SDK awaits it, so tool registration can do the
 * I/O the capability gate requires (one `listCapabilityAdapters` call per
 * distinct capability, `lazy: true`).
 */
export function createMcpServerFactory(version: string, registry: IMcpToolRegistryService) {
  return async (ctx: McpRequestContext): Promise<McpServer> => {
    const server = new McpServer({ name: SERVER_NAME, version });
    // `ctx` is REQUEST-scoped and is the only carrier of the principal — the
    // context passed to a tool callback at dispatch time has no `authInfo`.
    await registry.registerTools(server, ctx);
    return server;
  };
}
