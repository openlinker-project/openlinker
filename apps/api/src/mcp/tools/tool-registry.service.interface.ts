/**
 * MCP Tool Registry Service Interface
 *
 * Contract for resolving and registering the MCP tool surface (#1487).
 *
 * @module apps/api/src/mcp/tools
 */
import type { McpRequestContext, McpServer } from '@modelcontextprotocol/server';

export const MCP_TOOL_REGISTRY_SERVICE_TOKEN = Symbol('IMcpToolRegistryService');

export interface IMcpToolRegistryService {
  /**
   * Register every tool available to this request onto a fresh `McpServer`.
   *
   * Called once per HTTP request (the SDK builds a new server each time), so
   * `tools/list` is recomputed from live capability state on every call and
   * can never be stale — which is why the MCP `notifications/tools/list_changed`
   * mechanism is neither advertised nor needed here.
   *
   * `ctx` is the REQUEST-scoped context, and it is the only place the
   * OpenLinker principal is available: the context handed to a tool callback at
   * dispatch time does NOT carry `authInfo`. Tools therefore close over this
   * one. (Verified by integration test — Phase 0's `whoami` read the same
   * request-scoped value.)
   */
  registerTools(server: McpServer, ctx: McpRequestContext): Promise<void>;
}
