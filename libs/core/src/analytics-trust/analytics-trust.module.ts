/**
 * Analytics Trust Module
 *
 * NestJS module for the analytics data-trust read (#1982). Composes the
 * integrations, sync, and orders contexts via their published cross-context
 * seams (IIntegrationsService, ISyncJobsService, IOrderRecordService) — no
 * persistence of its own. Scheduler cadence is read through
 * ISyncJobsService.findEnabledPollTask, not by injecting
 * SchedulerTaskRegistryService directly. The earliest-order-date coverage
 * fact (#2083) is read through IOrderRecordService.getEarliestOrderDateByConnection,
 * never OrderRecordRepositoryPort directly.
 *
 * @module libs/core/src/analytics-trust
 */
import { Module } from '@nestjs/common';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { SyncModule } from '@openlinker/core/sync';
import { OrdersModule } from '@openlinker/core/orders';
import { AnalyticsTrustService } from './application/services/analytics-trust.service';
import { ANALYTICS_TRUST_SERVICE_TOKEN } from './analytics-trust.tokens';

@Module({
  imports: [IntegrationsModule, SyncModule, OrdersModule],
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
