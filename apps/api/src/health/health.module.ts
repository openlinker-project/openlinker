/**
 * Health Module
 *
 * Provides health checking capabilities for the development stack. Includes
 * checks for internal dependencies (PostgreSQL, Redis), external dependencies
 * (PrestaShop), and infrastructure-bearing connections (e.g. a connected
 * WooCommerce shop, #1619).
 *
 * @module apps/api/src/health
 */
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '@openlinker/shared/database';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { DevStackHealthService } from './dev-stack-health.service';
import { ConnectionInfraHealthService } from './connection-infra-health.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import {
  DEV_STACK_HEALTH_SERVICE_TOKEN,
  CONNECTION_INFRA_HEALTH_SERVICE_TOKEN,
} from './health.tokens';

export { DEV_STACK_HEALTH_SERVICE_TOKEN, CONNECTION_INFRA_HEALTH_SERVICE_TOKEN };

@Module({
  imports: [
    HttpModule,
    DatabaseModule,
    RedisConfigModule,
    // For CONNECTION_SERVICE_TOKEN + (re-exported) INTEGRATIONS_SERVICE_TOKEN,
    // used by ConnectionInfraHealthService to discover + probe infra-bearing
    // connections (#1619).
    IntegrationsModule,
  ],
  providers: [
    DevStackHealthService,
    {
      provide: DEV_STACK_HEALTH_SERVICE_TOKEN,
      useExisting: DevStackHealthService,
    },
    ConnectionInfraHealthService,
    {
      provide: CONNECTION_INFRA_HEALTH_SERVICE_TOKEN,
      useExisting: ConnectionInfraHealthService,
    },
  ],
  exports: [DEV_STACK_HEALTH_SERVICE_TOKEN],
})
export class HealthModule {}
