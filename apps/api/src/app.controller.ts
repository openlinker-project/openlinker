/**
 * Application Controller
 *
 * Root HTTP REST API controller providing basic application endpoints,
 * including health check and welcome message.
 *
 * @module apps/api/src
 */
import { Controller, Get, Inject, VERSION_NEUTRAL, Version } from '@nestjs/common';
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
    private readonly appInfoService: IAppInfoService
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

  @Get('health/dev-stack')
  async getDevStackHealth(): Promise<DevStackHealthResponse> {
    return this.devStackHealthService.checkDevStackHealth();
  }
}
