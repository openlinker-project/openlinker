/**
 * Application Controller
 *
 * Root HTTP REST API controller providing basic application endpoints,
 * including health check and welcome message.
 *
 * @module apps/api/src
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service';
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
    private readonly devStackHealthService: IDevStackHealthService
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth(): Promise<InternalHealthResponse> {
    return this.devStackHealthService.checkInternalHealth();
  }

  @Get('health/dev-stack')
  async getDevStackHealth(): Promise<DevStackHealthResponse> {
    return this.devStackHealthService.checkDevStackHealth();
  }
}
