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
   * `tools/list` is recomputed from live capability state on every call — the
   * SERVER is always fresh. OL does not advertise or send
   * `notifications/tools/list_changed` because stateless serving leaves no
   * session to push over; the accepted cost is that a CLIENT's cached list can
   * still go stale until it reconnects (ADR-033 § Phase 1 amendments).
   *
   * `ctx` is the REQUEST-scoped context, and it is the only place the
   * OpenLinker principal is available: the context handed to a tool callback at
   * dispatch time does NOT carry `authInfo`. Tools therefore close over this
   * one. (Verified by integration test — Phase 0's `whoami` read the same
   * request-scoped value.)
   */
  registerTools(server: McpServer, ctx: McpRequestContext): Promise<void>;
}
