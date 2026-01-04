/**
 * Health Module
 *
 * Provides health checking capabilities for the development stack. Includes
 * checks for internal dependencies (PostgreSQL, Redis) and external
 * dependencies (PrestaShop).
 *
 * @module apps/api/src/health
 */
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '@openlinker/shared/database';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { DevStackHealthService } from './dev-stack-health.service';

export const DEV_STACK_HEALTH_SERVICE_TOKEN = Symbol('IDevStackHealthService');

@Module({
  imports: [HttpModule, DatabaseModule, RedisConfigModule],
  providers: [
    DevStackHealthService,
    {
      provide: DEV_STACK_HEALTH_SERVICE_TOKEN,
      useExisting: DevStackHealthService,
    },
  ],
  exports: [DEV_STACK_HEALTH_SERVICE_TOKEN],
})
export class HealthModule {}

