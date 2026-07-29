/**
 * MCP Transport Controller
 *
 * The MCP Streamable-HTTP ingress (#1486, ADR-033).
 *
 * `@Public()` opts out of the global `JwtAuthGuard` — this route is
 * authenticated instead by the SDK's `requireBearerAuth` middleware applied
 * in `McpModule.configure`, which validates against `OlMcpTokenVerifier`.
 * The same `@Public()` + `VERSION_NEUTRAL` pairing is used by
 * `webhook.controller.ts`.
 *
 * `VERSION_NEUTRAL` is REQUIRED, not cosmetic: `main.ts` sets
 * `defaultVersion: v1`, and a URL pasted into an MCP client's config file
 * must not drift to `/v1/mcp`.
 *
 * The advertised server version comes from `AppInfoService` — the documented
 * resolution chain (`OL_PRODUCT_VERSION` → `npm_package_version` → dev
 * fallback, ADR-029/#1133). Reading `npm_package_version` directly would
 * advertise `0.0.0` in production, where the compiled `node dist/main.js`
 * process has no npm-injected version.
 *
 * `req.body` is forwarded as `parsedBody` because `main.ts` installs a
 * global `express.json()`; per the SDK, passing the already-parsed value
 * means nothing is read from the consumed stream.
 *
 * @module apps/api/src/mcp/transport
 */
import { All, Controller, Inject, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import { Logger } from '@openlinker/shared/logging';
import { APP_INFO_SERVICE_TOKEN } from '../../app-info/app-info.module';
import { MCP_TRANSPORT_PATH } from '../mcp-resource';
import { IAppInfoService } from '../../app-info/app-info.service.interface';
import { Public } from '../../auth/decorators/public.decorator';
import { createMcpServerFactory } from './mcp-server.factory';

@Public()
@ApiExcludeController()
@Controller({ path: MCP_TRANSPORT_PATH, version: VERSION_NEUTRAL })
export class McpTransportController {
  private readonly logger = new Logger(McpTransportController.name);
  private readonly handler: NodeMcpRequestHandler;

  constructor(
    @Inject(APP_INFO_SERVICE_TOKEN)
    appInfo: IAppInfoService
  ) {
    // Stateless: createMcpHandler builds a fresh server per request, so
    // there are no sessions and no sticky-routing requirement across
    // replicas.
    const mcpHandler = createMcpHandler(createMcpServerFactory(appInfo.getProductVersion()), {
      onerror: (error: Error) => {
        this.logger.error(`MCP handler error: ${error.message}`, error.stack);
      },
    });

    this.handler = toNodeHandler(mcpHandler, {
      onerror: (error: Error) => {
        this.logger.error(`MCP transport error: ${error.message}`, error.stack);
      },
    });
  }

  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    // Defence in depth. `requireBearerAuth` populates `req.auth`, and the SDK
    // handler performs NO verification of its own — so if the middleware ever
    // stops matching this path, the handler would happily serve the request
    // UNAUTHENTICATED.
    //
    // Sharing MCP_TRANSPORT_PATH kills drift between the controller and
    // `forRoutes`, but not every route to that state: `forRoutes` is not
    // global-prefix-aware, so introducing `setGlobalPrefix` could move this
    // controller while the middleware keeps matching a now-dead path. Critically,
    // the int-spec's header-less-request assertion would FOLLOW the controller
    // and keep passing — it cannot catch that class. This check can: it fails
    // CLOSED regardless of why the principal is absent.
    if (!req.auth) {
      this.logger.error(
        'MCP request reached the transport with no principal — the bearer middleware did not run for this path. Serving 401; check the middleware binding.'
      );
      res.status(401).json({ error: 'invalid_token', error_description: 'Authentication required' });
      return;
    }
    await this.handler(req, res, req.body);
  }
}
