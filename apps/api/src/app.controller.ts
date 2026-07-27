/**
 * Application Controller
 *
 * Root HTTP REST API controller providing basic application endpoints,
 * including health check and welcome message.
 *
 * @module apps/api/src
 */
import { Controller, Get, Inject, Req, VERSION_NEUTRAL, Version } from '@nestjs/common';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { AppService } from './app.service';
import { IAppInfoService } from './app-info/app-info.service.interface';
import { APP_INFO_SERVICE_TOKEN } from './app-info/app-info.module';
import { Public } from './auth/decorators/public.decorator';
import { IDevStackHealthService } from './health/dev-stack-health.service.interface';
import type {
  InternalHealthResponse,
  DevStackHealthResponse,
} from './health/dev-stack-health.types';
import { DEV_STACK_HEALTH_SERVICE_TOKEN } from './health/health.module';

@Public()
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Inject(DEV_STACK_HEALTH_SERVICE_TOKEN)
    private readonly devStackHealthService: IDevStackHealthService,
    @Inject(APP_INFO_SERVICE_TOKEN)
    private readonly appInfoService: IAppInfoService,
    private readonly jwtService: JwtService
  ) {}

  // Root welcome route stays reachable at `/` (no `/v1`) for load-balancer /
  // uptime probes that hit the bare origin (#1133).
  @Version(VERSION_NEUTRAL)
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth(): Promise<InternalHealthResponse> {
    const readiness = await this.devStackHealthService.checkInternalHealth();
    // App-info spread last so version/api stay authoritative even if the
    // readiness shape ever grows a colliding field.
    return { ...readiness, ...this.appInfoService.getAppInfo() };
  }

  // This route stays @Public() (no login gate) so it keeps working as a
  // pre-auth readiness probe, but the per-connection `name` and adapter
  // diagnostic `message` fields are only meaningful to an operator who is
  // already signed in — an anonymous caller only ever sees the generic
  // status shape (#1619 review: unauthenticated info disclosure).
  @Get('health/dev-stack')
  async getDevStackHealth(@Req() request: Request): Promise<DevStackHealthResponse> {
    const health = await this.devStackHealthService.checkDevStackHealth();
    if (await this.isAuthenticatedRequest(request)) {
      return health;
    }
    return {
      ...health,
      connections: health.connections.map((connection) => ({
        connectionId: connection.connectionId,
        platformType: connection.platformType,
        status: connection.status,
      })),
    };
  }

  /**
   * Best-effort bearer-token check: verifies signature + expiry via the same
   * `JwtService` the global `JwtAuthGuard` uses, but never throws or blocks
   * the (still-public) request — it only decides which response shape to
   * return.
   */
  private async isAuthenticatedRequest(request: Request): Promise<boolean> {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return false;
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return false;
    }
    try {
      await this.jwtService.verifyAsync(token);
      return true;
    } catch {
      return false;
    }
  }
}
