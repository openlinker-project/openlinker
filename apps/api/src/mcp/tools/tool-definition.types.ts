/**
 * MCP Tool Definition Types
 *
 * The neutral shape every MCP tool declares (#1487). A definition is data,
 * not behaviour wiring: it names the tool, states the capability that gates
 * its registration, and supplies a handler that does nothing but read +
 * project. Cross-cutting concerns (rate limiting, audit logging, error
 * mapping) are applied once by `ToolRegistryService`, never by a tool.
 *
 * Two facts are deliberately independent here (plan §3.3.0):
 *   - `requiredCapability` gates whether the tool is REGISTERED — it answers
 *     "is this deployment in the products/inventory/orders business?"
 *   - the handler reads OL's OWN store, so it can return an empty result even
 *     when the gate passes (freshly-added connection, no sync yet).
 * Every tool's `description` must therefore say which situation an empty
 * result represents — it is the only channel the calling agent reads.
 *
 * @module apps/api/src/mcp/tools
 */
import type { CallToolResult, McpRequestContext } from '@modelcontextprotocol/server';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import type { McpTokenScope } from '@openlinker/core/users';

/**
 * Capabilities that can gate a Phase-1 read tool. All three are well-known
 * members of `CoreCapabilityValues` — this is deliberately a closed set, not
 * the open string set the registry accepts, because Phase 1 ships a fixed
 * tool catalogue.
 *
 * NOTE both `as const` arrays in this file are currently consumed only for the
 * union types derived from them; nothing reads the runtime arrays yet. They are
 * kept in the shape `engineering-standards.md § Union Types` mandates (which
 * explicitly rejects a bare inline union precisely because it leaves no runtime
 * array to validate against) so that the first consumer needing validation —
 * e.g. a DTO for an operator-facing tool-audit filter — has one to bind to
 * without a refactor.
 */
export const McpToolCapabilityValues = ['ProductMaster', 'InventoryMaster', 'OrderSource'] as const;

export type McpToolCapability = (typeof McpToolCapabilityValues)[number];

/**
 * Outcome of a single tool call, as recorded by the audit log.
 *
 * `rate-limited` is distinct from `error`: the handler never ran, so the
 * call consumed no downstream resources and reflects client behaviour
 * rather than a fault.
 *
 * `forbidden` (#1488) is likewise distinct from both: the caller was
 * authenticated but lacked the scope or role the tool declares, so the handler
 * never ran and no rate-limit budget was spent. Keeping it separate from
 * `error` matters operationally — a burst of `forbidden` is a mis-scoped token
 * (or a probe), not a fault to page on.
 *
 * Log-only: `McpAuditLogger` writes structured log lines and has no ORM entity,
 * so widening this union needs no migration.
 */
export const McpToolOutcomeValues = ['ok', 'error', 'rate-limited', 'forbidden'] as const;

export type McpToolOutcome = (typeof McpToolOutcomeValues)[number];

/**
 * A tool handler: reads, projects, returns. It receives already-validated
 * arguments and the request context carrying the principal.
 *
 * A handler MUST NOT log the audit line, acquire a rate-limit slot, or map
 * its own errors to agent-facing copy — `ToolRegistryService` owns all
 * three so they cannot be forgotten (plan §3.3.3).
 */
export type McpToolHandler = (
  args: Record<string, unknown>,
  ctx: McpRequestContext
) => Promise<CallToolResult>;

/**
 * A registrable MCP tool.
 */
export interface McpToolDefinition {
  /**
   * Stable, connection-independent name (`search_catalog`, never
   * `search_catalog__allegro-main`). Baking a connection into the name would
   * explode the surface to N connections x M capabilities.
   */
  readonly name: string;

  /**
   * Capability that must be supported AND enabled on at least one connection
   * for this tool to appear in `tools/list`. `null` means always registered
   * (`list_connections`, `whoami` — the discovery entry points, which must
   * work even on a deployment with no connections at all).
   */
  readonly requiredCapability: McpToolCapability | null;

  /**
   * Token scope this tool requires (#1488).
   *
   * REQUIRED, deliberately not optional-with-default. A write tool that forgot
   * to declare it would default to the unprivileged value — the wrong failure
   * direction for a security field. Making it required means every new tool
   * states its posture at the compiler.
   *
   * Note `McpTokenService.expandScopes` grants BOTH scopes to a write token
   * (`mcp:write` implies `mcp:read`), so this is a floor, not an equality test.
   */
  readonly requiredScope: McpTokenScope;

  /**
   * Whether the token's owning user must hold the `admin` role (#1488).
   *
   * A token inherits its owner's RBAC role (#1486), so this is checked against
   * the owner and can never exceed them.
   */
  readonly requiresAdmin: boolean;

  /** Agent-facing description. See the module header on empty-result semantics. */
  readonly description: string;

  /** Zod schema for the tool's arguments. */
  readonly inputSchema: StandardSchemaWithJSON;

  readonly handler: McpToolHandler;
}
