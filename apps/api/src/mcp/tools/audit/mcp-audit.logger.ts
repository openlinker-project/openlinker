/**
 * MCP Audit Logger
 *
 * One structured line per MCP tool call (#1487) — who called what, against
 * which connection, with what outcome and latency.
 *
 * SECURITY: the caller is recorded via `redactPrincipal`, never from the
 * `AuthInfo` itself, which carries the RAW bearer token (#1486 invariant,
 * see `mcp-principal.types.ts`). This logger never accepts an `AuthInfo`
 * parameter at all — the unsafe value is structurally out of reach rather
 * than merely undocumented.
 *
 * Invoked exclusively from `ToolRegistryService`'s per-call wrapper, so no
 * tool can forget to emit one.
 *
 * @implements {IMcpAuditLogger}
 *
 * @module apps/api/src/mcp/tools/audit
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import type { IMcpAuditLogger, McpToolCallAudit } from './mcp-audit.logger.interface';

@Injectable()
export class McpAuditLogger implements IMcpAuditLogger {
  private readonly logger = new Logger('McpToolCall');

  record(audit: McpToolCallAudit): void {
    const line = {
      tool: audit.tool,
      outcome: audit.outcome,
      durationMs: audit.durationMs,
      ...(audit.connectionId !== undefined ? { connectionId: audit.connectionId } : {}),
      ...(audit.detail !== undefined ? { detail: audit.detail } : {}),
      // Spread LAST so a principal field can never be shadowed by the above,
      // and only ever the redacted projection.
      ...(audit.principal !== null
        ? {
            mcpTokenId: audit.principal.mcpTokenId,
            olUserId: audit.principal.olUserId,
            olRole: audit.principal.olRole,
            scopes: audit.principal.scopes,
          }
        : { principal: 'none' }),
    };

    const message = JSON.stringify(line);

    // An unauthenticated call reaching a tool is security-relevant: the
    // transport fails closed and the bearer middleware gates the route, so
    // it should be impossible. Make it loud rather than routine.
    if (audit.principal === null) {
      this.logger.error(message);
      return;
    }
    if (audit.outcome === 'error') {
      this.logger.warn(message);
      return;
    }
    this.logger.log(message);
  }
}
