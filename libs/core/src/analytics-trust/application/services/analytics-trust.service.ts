/**
 * Analytics Trust Service
 *
 * Composes IIntegrationsService (enumerate OrderSource connections),
 * ISyncJobsService (last successful ingestion job per connection), and
 * SchedulerTaskRegistryService (per-platform poll cadence) into the
 * analytics data-trust snapshot (#1982): freshness, coverage window, and
 * stalled status for every OrderSource-capable connection. Read-only —
 * never writes, never triggers ingestion.
 *
 * A single connection's build failure is caught and degraded to a
 * never-ingested entry (logged) rather than failing the whole snapshot —
 * mirrors ConnectionInfraHealthService's per-connection isolation.
 *
 * @module libs/core/src/analytics-trust/application/services
 * @implements {IAnalyticsTrustService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { SchedulerTaskConfig } from '@openlinker/core/sync';
import {
  SYNC_JOBS_SERVICE_TOKEN,
  SCHEDULER_TASK_REGISTRY_TOKEN,
  SchedulerTaskRegistryService,
 ISyncJobsService} from '@openlinker/core/sync';
import type { IAnalyticsTrustService } from './analytics-trust.service.interface';
import type {
  AnalyticsTrustSnapshot,
  ConnectionIngestionTrust,
} from '../../domain/types/connection-ingestion-trust.types';
import { STALE_THRESHOLD_MULTIPLIER } from '../../domain/types/connection-ingestion-trust.types';
import {
  classifyIngestionStatus,
  estimateCronIntervalMs,
} from '../../domain/domain-services/ingestion-trust.domain-service';

const ORDER_SOURCE_CAPABILITY = 'OrderSource';
const ORDERS_POLL_JOB_TYPE = 'marketplace.orders.poll';

@Injectable()
export class AnalyticsTrustService implements IAnalyticsTrustService {
  private readonly logger = new Logger(AnalyticsTrustService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(SYNC_JOBS_SERVICE_TOKEN)
    private readonly syncJobsService: ISyncJobsService,
    @Inject(SCHEDULER_TASK_REGISTRY_TOKEN)
    private readonly schedulerTaskRegistry: SchedulerTaskRegistryService
  ) {}

  async getIngestionTrustSnapshot(): Promise<AnalyticsTrustSnapshot> {
    const entries = await this.integrationsService.listCapabilityAdapters({
      capability: ORDER_SOURCE_CAPABILITY,
      lazy: true,
    });

    const pollTasks = this.schedulerTaskRegistry
      .getAll()
      .filter((task) => task.jobType === ORDERS_POLL_JOB_TYPE);

    const now = new Date();
    const connections = await Promise.all(
      entries.map((entry) => this.buildTrustEntry(entry.connection, pollTasks, now))
    );

    return { generatedAt: now, connections };
  }

  private async buildTrustEntry(
    connection: Connection,
    pollTasks: SchedulerTaskConfig[],
    now: Date
  ): Promise<ConnectionIngestionTrust> {
    try {
      const matchingTask = pollTasks.find((task) => task.platformType === connection.platformType);
      const expectedIntervalMs = matchingTask
        ? estimateCronIntervalMs(matchingTask.cronExpression, now)
        : null;
      const staleAfterMs =
        expectedIntervalMs !== null ? expectedIntervalMs * STALE_THRESHOLD_MULTIPLIER : null;

      const lastJob = matchingTask
        ? await this.syncJobsService.findLastSucceededJob(connection.id, matchingTask.jobType)
        : null;
      const lastSuccessfulIngestionAt = lastJob ? new Date(lastJob.updatedAt) : null;

      return {
        connectionId: connection.id,
        connectionName: connection.name,
        platformType: connection.platformType,
        status: classifyIngestionStatus(lastSuccessfulIngestionAt, staleAfterMs, now),
        lastSuccessfulIngestionAt,
        coverageStartAt: connection.createdAt,
        expectedIntervalMs,
        staleAfterMs,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to build ingestion trust entry for connection ${connection.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return {
        connectionId: connection.id,
        connectionName: connection.name,
        platformType: connection.platformType,
        status: 'never-ingested',
        lastSuccessfulIngestionAt: null,
        coverageStartAt: connection.createdAt,
        expectedIntervalMs: null,
        staleAfterMs: null,
      };
    }
  }
}
