/**
 * MCP Tool Registry Service
 *
 * Resolves the per-request MCP tool surface (#1487) and owns the single
 * choke point through which every tool call passes.
 *
 * TWO RESPONSIBILITIES, both deliberately here rather than in tool files:
 *
 * 1. CAPABILITY-DECLARED REGISTRATION. A tool is registered iff at least one
 *    connection both supports AND has enabled its required capability.
 *    `listCapabilityAdapters` already intersects the adapter manifest with the
 *    connection's `enabledCapabilities`, so both halves come free;
 *    `lazy: true` avoids constructing adapters merely to answer `tools/list`.
 *
 *    NOTE the gate and the DATA SOURCE are independent facts: tools read OL's
 *    own store, so a passing gate does not imply data exists (a freshly added
 *    connection publishes its tools before any sync has run), and a disabled
 *    connection hides tools whose data OL still holds. Each tool's description
 *    states this — see `tool-definition.types.ts`.
 *
 * 2. THE PER-CALL WRAPPER. Rate limiting, audit logging, and error mapping are
 *    per-call and tool-agnostic. Applied here, they are structural. Left to
 *    each tool, they would be five independent chances to forget to release an
 *    in-flight slot on the throw path — and a missed release leaks that slot
 *    until it ages out. Tool files therefore contain ONLY their read and
 *    projection; they never import the limiter or the logger.
 *
 * 3. SCOPE + ROLE ENFORCEMENT (#1488), in TWO places, deliberately:
 *
 *    - At REGISTRATION, so a principal who cannot call a tool never sees it in
 *      `tools/list`. That is a LISTING concern (better agent UX, smaller
 *      surface) — emphatically NOT the security boundary.
 *    - At CALL TIME, which IS the guard. Nothing stops an MCP client invoking a
 *      name it was never shown, so only this check actually refuses.
 *
 *    Both run before `rateLimiter.acquire`, so a refused call spends no budget.
 *
 * @module apps/api/src/mcp/tools
 * @implements {IMcpToolRegistryService}
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  CallToolResult,
  McpRequestContext,
  McpServer,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';

import { redactPrincipal, type RedactedMcpPrincipal } from '../auth/mcp-principal.types';
import {
  MCP_AUDIT_LOGGER_TOKEN,
  type IMcpAuditLogger,
} from './audit/mcp-audit.logger.interface';
import {
  MCP_RATE_LIMITER_TOKEN,
  type IMcpRateLimiter,
} from './ratelimit/mcp-rate-limiter.interface';
import { MCP_TOOL_DEFINITIONS_TOKEN } from './mcp-tool-definitions.provider';
import type { IMcpToolRegistryService } from './tool-registry.service.interface';
import type { McpToolCapability, McpToolDefinition, McpToolOutcome } from './tool-definition.types';

@Injectable()
export class McpToolRegistryService implements IMcpToolRegistryService {
  private readonly logger = new Logger(McpToolRegistryService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(MCP_RATE_LIMITER_TOKEN)
    private readonly rateLimiter: IMcpRateLimiter,
    @Inject(MCP_AUDIT_LOGGER_TOKEN)
    private readonly auditLogger: IMcpAuditLogger,
    @Inject(MCP_TOOL_DEFINITIONS_TOKEN)
    private readonly definitions: readonly McpToolDefinition[]
  ) {}

  async registerTools(server: McpServer, ctx: McpRequestContext): Promise<void> {
    const available = await this.resolveAvailableCapabilities();
    const principal = redactPrincipal(ctx.authInfo?.extra, ctx.authInfo?.scopes ?? []);

    for (const definition of this.definitions) {
      if (definition.requiredCapability !== null && !available.has(definition.requiredCapability)) {
        continue;
      }
      // Listing-time filter only; `invoke` re-checks — see the module header.
      //
      // A principal-less request is deliberately NOT filtered here: there is
      // nothing to evaluate scope against, and filtering would make `invoke`'s
      // defensive no-principal branch unreachable. Registration is a listing
      // concern; refusing is the call-time guard's job, and it refuses.
      if (principal !== null && describeAuthzRefusal(definition, principal) !== null) {
        continue;
      }
      // The SDK's `registerTool` is generic over each tool's own schema, so its
      // callback type is narrowed per call site. This registry is deliberately
      // schema-agnostic (it registers a heterogeneous list), so it binds to the
      // narrow structural view below instead — which states exactly the surface
      // depended on, rather than erasing it with `any`.
      asToolRegistrar(server).registerTool(
        definition.name,
        { description: definition.description, inputSchema: definition.inputSchema },
        // Close over the REQUEST-scoped ctx: the context the SDK hands a tool
        // callback at dispatch time does not carry `authInfo`.
        (args) => this.invoke(definition, args, ctx)
      );
    }
  }

  /**
   * Which of the gating capabilities are backed by at least one
   * supporting-and-enabled connection. One `listCapabilityAdapters` call per
   * DISTINCT capability, not per tool — a base port backs several tools.
   */
  private async resolveAvailableCapabilities(): Promise<Set<McpToolCapability>> {
    const required = new Set<McpToolCapability>();
    for (const definition of this.definitions) {
      if (definition.requiredCapability !== null) {
        required.add(definition.requiredCapability);
      }
    }

    const available = new Set<McpToolCapability>();
    await Promise.all(
      [...required].map(async (capability) => {
        try {
          const entries = await this.integrationsService.listCapabilityAdapters({
            capability,
            lazy: true,
          });
          if (entries.length > 0) {
            available.add(capability);
          }
        } catch (error) {
          // A broken connection must not blank the whole tool surface. Treat
          // the capability as unavailable and say so — an absent tool with a
          // logged cause beats a 500 on `tools/list`.
          this.logger.warn(
            `Could not resolve MCP capability "${capability}"; its tools will not be listed. ${
              (error as Error).message
            }`
          );
        }
      })
    );
    return available;
  }

  /**
   * The wrapper. Ordering is load-bearing:
   *   acquire → (handler | skip) → release in `finally` → audit on every path.
   */
  private async invoke(
    definition: McpToolDefinition,
    args: Record<string, unknown>,
    ctx: McpRequestContext
  ): Promise<CallToolResult> {
    const startedAt = Date.now();
    const principal = redactPrincipal(ctx.authInfo?.extra, ctx.authInfo?.scopes ?? []);
    const connectionId = readConnectionArg(args);

    const emit = (outcome: McpToolOutcome, detail?: string): void => {
      this.auditLogger.record({
        tool: definition.name,
        outcome,
        durationMs: Date.now() - startedAt,
        connectionId,
        principal,
        detail,
      });
    };

    // No principal ⇒ no stable key to meter on. The transport fails closed and
    // the bearer middleware gates the route, so this is unreachable in
    // practice; treat it as an error rather than silently metering globally.
    if (principal === null) {
      emit('error', 'no principal on request');
      return toolError('No OpenLinker principal on this request.');
    }

    // Before the limiter: a refused call must not spend the caller's budget,
    // and this is the check that actually guards (registration filtering is a
    // listing concern — an MCP client may invoke an unlisted name).
    const refusal = describeAuthzRefusal(definition, principal);
    if (refusal !== null) {
      emit('forbidden', refusal);
      return toolError(refusal);
    }

    const lease = await this.rateLimiter.acquire(principal.mcpTokenId);
    if (!lease.allowed) {
      emit('rate-limited', lease.reason);
      return toolError(lease.reason ?? 'Rate limit exceeded.');
    }

    try {
      const result = await definition.handler(args, ctx);
      emit(result.isError === true ? 'error' : 'ok');
      return result;
    } catch (error) {
      const message = (error as Error).message;
      emit('error', message);
      // Agent-facing copy: the calling model reads this and decides what to do
      // next, so surface the message but keep it framed as a tool failure.
      return toolError(`${definition.name} failed: ${message}`);
    } finally {
      await lease.release();
    }
  }
}

function toolError(text: string): CallToolResult {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/**
 * Why this principal may not call this tool, or `null` if it may (#1488).
 *
 * Returns agent-facing copy naming what is MISSING rather than a bare denial —
 * the calling model reads it to decide whether to give up or ask its operator
 * for a differently-scoped token.
 *
 * One function, used by both the registration filter and the call-time guard,
 * so the two can never disagree about what "allowed" means.
 */
export function describeAuthzRefusal(
  definition: McpToolDefinition,
  principal: RedactedMcpPrincipal
): string | null {
  if (!principal.scopes.includes(definition.requiredScope)) {
    return `This tool requires the "${definition.requiredScope}" scope; the token used has [${principal.scopes.join(', ')}].`;
  }
  if (definition.requiresAdmin && principal.olRole !== 'admin') {
    return `This tool requires the OpenLinker "admin" role; the token's owner has "${principal.olRole}".`;
  }
  return null;
}

/**
 * The connection a call is about, for audit attribution.
 *
 * Checks `destinationConnectionId` as well as `connectionId` (#1488): the
 * mapping tools key on the former, matching `IMappingConfigService`'s own
 * parameter name. Resolved HERE rather than by renaming those tool arguments,
 * so the seam stays one place — otherwise the next tool keying on some third
 * name silently reopens the same hole, and an unattributable WRITE audit line
 * is the one this would have lost first.
 */
function readConnectionArg(args: Record<string, unknown>): string | undefined {
  for (const key of ['connectionId', 'destinationConnectionId'] as const) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * The exact slice of `McpServer` this registry uses.
 *
 * Declaring it explicitly (rather than casting the callback to `any`) keeps the
 * dependency legible: if the SDK changes this signature, the cast below stops
 * compiling instead of silently accepting a mismatched handler.
 */
interface ToolRegistrar {
  registerTool(
    name: string,
    config: { description: string; inputSchema: StandardSchemaWithJSON },
    cb: (args: Record<string, unknown>) => Promise<CallToolResult>
  ): unknown;
}

function asToolRegistrar(server: McpServer): ToolRegistrar {
  return server as unknown as ToolRegistrar;
}
