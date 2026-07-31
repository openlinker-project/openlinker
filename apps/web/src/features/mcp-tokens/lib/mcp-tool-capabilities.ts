/**
 * MCP Tool-Backing Capabilities
 *
 * The capabilities that back at least one MCP tool. Used to decide whether the
 * tool-staleness hint (#1949) is relevant to a given connection at all — a
 * connection supporting none of these can never contribute a tool, so telling
 * its operator to reconnect an agent would be noise.
 *
 * **Source of truth is the backend**: `McpToolCapabilityValues` in
 * `apps/api/src/mcp/tools/tool-definition.types.ts`. `apps/web` cannot import
 * from `apps/api`, so this is a hand-maintained mirror. #1488 and #1489 both add
 * MCP tools — if either registers one behind a capability not listed here, the
 * hint stops appearing on connections that do carry a tool.
 *
 * Half of the drift is caught at compile time: the consumer in
 * `ConnectionCapabilitiesPanel` iterates this list against `CoreCapability[]`,
 * so adding a value that is not a core capability fails `type-check`. The other
 * half — the backend adding a tool whose capability is simply *missing* here —
 * is not guarded (a `check-permission-mirror.mjs`-shaped lint script would be
 * disproportionate for a hint's visibility gate), and its failure mode is a
 * missing hint rather than wrong behaviour.
 *
 * @module apps/web/src/features/mcp-tokens/lib
 * @see {@link MCP_CONNECTION_CHANGE_HINT} for the copy this gates
 */
export const MCP_TOOL_CAPABILITIES = ['ProductMaster', 'InventoryMaster', 'OrderSource'] as const;

export type McpToolCapability = (typeof MCP_TOOL_CAPABILITIES)[number];
