/**
 * MCP Module
 *
 * Wires OpenLinker's MCP surface (#1486, ADR-033 / ADR-034):
 *
 *  - `McpTokensController` — admin token management, ordinary session auth.
 *  - `McpTransportController` — the Streamable-HTTP ingress, bearer-auth'd.
 *  - `OlMcpTokenVerifier` — the Resource-Server seam.
 *
 * Imports `UsersModule` because that is where `MCP_TOKEN_SERVICE_TOKEN` is
 * provided: the token store and its service live in the `users` bounded
 * context (a service outside that context may not inject a
 * `*RepositoryPort` — see `scripts/check-cross-context-imports.mjs`).
 *
 * `configure()` applies the SDK's `requireBearerAuth` as Express middleware
 * scoped to `/mcp`. This is the repository's first `MiddlewareConsumer` —
 * deliberate, not incidental. The house pattern is a path-scoped
 * `app.use()` in `main.ts` (as `/webhooks` does), and a `RawBodyMiddleware`
 * class was once removed in favour of it — but that removal was driven by
 * body-parse ORDERING at bootstrap, which does not apply to bearer auth.
 * The middleware here needs the DI-provided verifier, which is natural in a
 * module and awkward in `main.ts`, and keeping the wiring inside this module
 * keeps the feature cohesive. Reversible to a `main.ts` hook without
 * touching the verifier.
 *
 * @module apps/api/src/mcp
 */
import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { requireBearerAuth } from '@modelcontextprotocol/express';
import { UsersModule } from '@openlinker/core/users';
import { ProductsModule } from '@openlinker/core/products';
import { InventoryModule } from '@openlinker/core/inventory';
import { OrdersModule } from '@openlinker/core/orders';
import { AppInfoModule } from '../app-info/app-info.module';
// The HOST integrations module (apps/api), NOT the core one — it provides
// CONNECTION_SERVICE_TOKEN and re-exports CoreIntegrationsModule (which
// carries INTEGRATIONS_SERVICE_TOKEN), so this single import covers both
// capability gating and `list_connections`. Aliased because the core module
// exports a class of the same name; an unaliased import here would be a
// silent shadowing bug.
import { IntegrationsModule as HostIntegrationsModule } from '../integrations/integrations.module';
import { MCP_TRANSPORT_PATH } from './mcp-resource';
import { OlMcpTokenVerifier } from './auth/ol-mcp-token.verifier';
import { McpTokensController } from './http/mcp-tokens.controller';
import { McpTransportController } from './transport/mcp-transport.controller';
import { McpAuditLogger } from './tools/audit/mcp-audit.logger';
import { McpRateLimiter } from './tools/ratelimit/mcp-rate-limiter';
import { MCP_RATE_LIMITER_TOKEN } from './tools/ratelimit/mcp-rate-limiter.interface';
import { McpToolRegistryService } from './tools/tool-registry.service';
import { MCP_TOOL_REGISTRY_SERVICE_TOKEN } from './tools/tool-registry.service.interface';
import { mcpToolDefinitionsProvider } from './tools/mcp-tool-definitions.provider';

@Module({
  imports: [
    UsersModule,
    AppInfoModule,
    HostIntegrationsModule,
    ProductsModule,
    InventoryModule,
    OrdersModule,
  ],
  controllers: [McpTokensController, McpTransportController],
  providers: [
    OlMcpTokenVerifier,
    McpAuditLogger,
    McpRateLimiter,
    { provide: MCP_RATE_LIMITER_TOKEN, useExisting: McpRateLimiter },
    mcpToolDefinitionsProvider,
    McpToolRegistryService,
    { provide: MCP_TOOL_REGISTRY_SERVICE_TOKEN, useExisting: McpToolRegistryService },
  ],
  exports: [OlMcpTokenVerifier],
})
export class McpModule implements NestModule {
  constructor(private readonly verifier: OlMcpTokenVerifier) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        requireBearerAuth({
          verifier: this.verifier,
          // Every MCP call needs at least read. Write-scoped routes pass
          // ['mcp:write'] — that arrives with #1489's write tools.
          requiredScopes: ['mcp:read'],
        })
      )
      .forRoutes({ path: MCP_TRANSPORT_PATH, method: RequestMethod.ALL });
  }
}
