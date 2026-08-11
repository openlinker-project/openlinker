/**
 * Analytics Trust Module
 *
 * NestJS module for the analytics data-trust read (#1982). Composes the
 * integrations and sync contexts via their published cross-context seams
 * (IIntegrationsService, ISyncJobsService, SchedulerTaskRegistryService) —
 * no persistence of its own.
 *
 * @module libs/core/src/analytics-trust
 */
import { Module } from '@nestjs/common';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { SyncModule } from '@openlinker/core/sync';
import { AnalyticsTrustService } from './application/services/analytics-trust.service';
import { ANALYTICS_TRUST_SERVICE_TOKEN } from './analytics-trust.tokens';

@Module({
  imports: [IntegrationsModule, SyncModule],
  providers: [
    AnalyticsTrustService,
    {
      provide: ANALYTICS_TRUST_SERVICE_TOKEN,
      useExisting: AnalyticsTrustService,
    },
  ],
  exports: [ANALYTICS_TRUST_SERVICE_TOKEN],
})
export class AnalyticsTrustModule {}
