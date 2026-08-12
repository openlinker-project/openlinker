/**
 * Analytics Trust Service
 *
 * Composes IIntegrationsService (enumerate OrderSource connections) and
 * ISyncJobsService (last successful poll / order-ingestion job per
 * connection, and the connection's live poll cadence) into the analytics
 * data-trust snapshot (#1982): poll liveness, order-data recency, and
 * stalled status for every OrderSource-capable connection. Read-only —
 * never writes, never triggers ingestion.
 *
 * A single connection's build failure is caught and degraded to an
 * `'unknown'` entry (logged) rather than failing the whole snapshot, and
 * rather than asserting the false claim `'never-ingested'` — mirrors
 * ConnectionInfraHealthService's per-connection isolation, but degrades to
 * a distinct status value the way that service does, not to a domain value
 * that makes a claim about the operator's data.
 *
 * The job lookup for a connection is never gated on a scheduler task being
 * registered — a poll task can be legitimately disabled (webhook-first
 * platforms) while the connection keeps ingesting fine via
 * `marketplace.order.sync`. The task registry is consulted only to derive
 * the *staleness threshold*, and only from a currently-*enabled* task —
 * see `ISyncJobsService.findEnabledPollTask`.
 *
 * @module libs/core/src/analytics-trust/application/services
 * @implements {IAnalyticsTrustService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { SYNC_JOBS_SERVICE_TOKEN, ISyncJobsService } from '@openlinker/core/sync';
import type { IAnalyticsTrustService } from './analytics-trust.service.interface';
import type {
  AnalyticsTrustSnapshot,
  ConnectionIngestionTrust,
} from '../../domain/types/connection-ingestion-trust.types';
import {
  STALE_THRESHOLD_MULTIPLIER,
  MIN_STALE_THRESHOLD_MS,
} from '../../domain/types/connection-ingestion-trust.types';
import {
  classifyIngestionStatus,
  computeStaleAfterMs,
  computeWorstStatus,
  estimateCronIntervalMs,
} from '../../domain/domain-services/ingestion-trust.domain-service';

const ORDER_SOURCE_CAPABILITY = 'OrderSource';
const ORDERS_POLL_JOB_TYPE = 'marketplace.orders.poll';
const ORDER_SYNC_JOB_TYPE = 'marketplace.order.sync';

@Injectable()
export class AnalyticsTrustService implements IAnalyticsTrustService {
  private readonly logger = new Logger(AnalyticsTrustService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(SYNC_JOBS_SERVICE_TOKEN)
    private readonly syncJobsService: ISyncJobsService
  ) {}

  async getIngestionTrustSnapshot(): Promise<AnalyticsTrustSnapshot> {
    const entries = await this.integrationsService.listCapabilityAdapters({
      capability: ORDER_SOURCE_CAPABILITY,
      lazy: true,
    });

    const now = new Date();
    const connections = await Promise.all(
      entries.map((entry) => this.buildTrustEntry(entry.connection, now))
    );

    return {
      generatedAt: now,
      worstStatus: computeWorstStatus(connections.map((c) => c.status)),
      connections,
    };
  }

  private async buildTrustEntry(connection: Connection, now: Date): Promise<ConnectionIngestionTrust> {
    try {
      // Always read the jobs — never gated on a scheduler task existing.
      // A poll task can be disabled while the connection ingests fine via
      // webhooks; the evidence and the cadence are independent facts.
      const [lastPollJob, lastOrderSyncJob] = await Promise.all([
        this.syncJobsService.findLastSucceededJob(connection.id, ORDERS_POLL_JOB_TYPE),
        this.syncJobsService.findLastSucceededJob(connection.id, ORDER_SYNC_JOB_TYPE),
      ]);
      const lastPollAt = lastPollJob ? new Date(lastPollJob.updatedAt) : null;
      const lastOrderIngestedAt = lastOrderSyncJob ? new Date(lastOrderSyncJob.updatedAt) : null;

      // Cadence is derived only from a currently *enabled* task — a
      // registered-but-disabled task must not become a false stalled
      // threshold for a webhook-fed connection.
      const enabledTask = this.syncJobsService.findEnabledPollTask(
        connection.platformType,
        ORDERS_POLL_JOB_TYPE
      );
      const expectedIntervalMs = enabledTask
        ? estimateCronIntervalMs(enabledTask.cronExpression, now)
        : null;
      const staleAfterMs =
        expectedIntervalMs !== null
          ? computeStaleAfterMs(expectedIntervalMs, STALE_THRESHOLD_MULTIPLIER, MIN_STALE_THRESHOLD_MS)
          : null;

      return {
        connectionId: connection.id,
        connectionName: connection.name,
        platformType: connection.platformType,
        status: classifyIngestionStatus(lastPollAt, staleAfterMs, now),
        lastPollAt,
        lastOrderIngestedAt,
        connectionCreatedAt: connection.createdAt,
        expectedIntervalMs,
        staleAfterMs,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to build ingestion trust entry for connection ${connection.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return this.buildDegradedEntry(connection);
    }
  }

  private buildDegradedEntry(connection: Connection): ConnectionIngestionTrust {
    return {
      connectionId: connection.id,
      connectionName: connection.name,
      platformType: connection.platformType,
      // 'unknown', never 'never-ingested' — a build failure is an
      // infrastructure fact, not a claim about the operator's data (a
      // transient repository error must not assert "this connection has
      // never ingested anything").
      status: 'unknown',
      lastPollAt: null,
      lastOrderIngestedAt: null,
      connectionCreatedAt: connection.createdAt,
      expectedIntervalMs: null,
      staleAfterMs: null,
    };
  }
}
