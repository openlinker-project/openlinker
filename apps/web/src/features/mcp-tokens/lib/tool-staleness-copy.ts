/**
 * MCP Tool-Staleness Copy
 *
 * The operator-facing wording for one fact: a client caches its MCP tool list,
 * so a connection change is not visible to an already-connected agent until it
 * reconnects. OL serves MCP statelessly, so there is no session to push
 * `notifications/tools/list_changed` over (ADR-033) — this is copy, not a
 * workaround, and closing the gap for real would mean adopting sessions.
 *
 * Two strings rather than one, deliberately. The wordings differ because the
 * surfaces differ — the settings panel (#1932) has room for two sentences and
 * must explain what governs tool availability at all; the connection hint
 * (#1949) sits beside the toggle that just caused the staleness and has room
 * for one line. Keeping both here means the guidance has a single place to be
 * edited even though it is not a single sentence.
 *
 * @module apps/web/src/features/mcp-tokens/lib
 * @see {@link MCP_TOOL_CAPABILITIES} for which connections the hint is shown on
 */

/** Settings page (`/settings/mcp-tokens`), read while wiring up a client. */
export const MCP_TOOL_AVAILABILITY_NOTE =
  'Which tools a client sees depends on which connections are enabled and what they support. ' +
  'Clients cache that list — after enabling or disabling a connection, reconnect the client for ' +
  'the change to appear.';

/**
 * Connection capabilities panel, read at the moment of the change.
 *
 * Keeps the capability half ("tools follow capabilities") rather than reducing
 * to a bare "reconnect your client", which reads as a bug workaround instead of
 * a consequence of capability-gated tool registration.
 */
export const MCP_CONNECTION_CHANGE_HINT =
  'MCP tools follow these capabilities — an already-connected agent must reconnect to see a change.';
