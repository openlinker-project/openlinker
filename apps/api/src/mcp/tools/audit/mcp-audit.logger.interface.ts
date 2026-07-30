/**
 * MCP Audit Logger Interface
 *
 * Contract for recording one line per MCP tool call (#1487).
 *
 * It exists for the same reason `IMcpRateLimiter` does: both are collaborators
 * of `McpToolRegistryService`'s per-call wrapper, and the registry should code
 * against an interface for either or neither. Injecting one concretely and the
 * other by token invited a "why the asymmetry?" with no answer.
 *
 * SECURITY: the audit shape takes a `RedactedMcpPrincipal`, never an `AuthInfo`.
 * The raw bearer token is therefore not even expressible here — the invariant
 * is enforced by the type, not by a convention (#1486).
 *
 * @module apps/api/src/mcp/tools/audit
 */
import type { RedactedMcpPrincipal } from '../../auth/mcp-principal.types';
import type { McpToolOutcome } from '../tool-definition.types';

export const MCP_AUDIT_LOGGER_TOKEN = Symbol('IMcpAuditLogger');

export interface McpToolCallAudit {
  readonly tool: string;
  readonly outcome: McpToolOutcome;
  readonly durationMs: number;
  /** Present only for tools that accept a connection argument. */
  readonly connectionId?: string;
  /** `null` when the call somehow arrived with no recognisable principal. */
  readonly principal: RedactedMcpPrincipal | null;
  /** Error message for `outcome: 'error'`, limit reason for `'rate-limited'`. */
  readonly detail?: string;
}

export interface IMcpAuditLogger {
  record(audit: McpToolCallAudit): void;
}
