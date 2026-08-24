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
 * Connections are enumerated regardless of `connection.status`
 * (`includeAllStatuses: true`) — the single most common real ingestion
 * death is an Allegro token flipping to `needs_reauth`, and a trust read
 * that silently drops exactly the connections it exists to warn about
 * would report green while ingestion is dead. A non-`'active'` connection
 * is always classified `'disconnected'`, overriding whatever its poll
 * history would otherwise say.
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
import { ORDER_RECORD_SERVICE_TOKEN, IOrderRecordService } from '@openlinker/core/orders';
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
    private readonly syncJobsService: ISyncJobsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService
  ) {}

  async getIngestionTrustSnapshot(): Promise<AnalyticsTrustSnapshot> {
    const entries = await this.integrationsService.listCapabilityAdapters({
      capability: ORDER_SOURCE_CAPABILITY,
      lazy: true,
      includeAllStatuses: true,
    });

    const now = new Date();
    // Batched once across every enumerated connection (#2083) — never move
    // this inside buildTrustEntry, which would silently reintroduce an N+1
    // query per connection for this one field. This is a supplementary
    // field: a failure here must degrade to an empty Map (every connection
    // reports earliestOrderDate: null) rather than throw out of the whole
    // snapshot — the per-connection isolation this service documents about
    // itself would otherwise not hold for this one batched read.
    const connectionIds = entries.map((entry) => entry.connection.id);
    const earliestOrderDates = await this.getEarliestOrderDatesSafely(connectionIds);

    const connections = await Promise.all(
      entries.map((entry) => this.buildTrustEntry(entry.connection, now, earliestOrderDates))
    );

    return {
      generatedAt: now,
      worstStatus: computeWorstStatus(connections.map((c) => c.status)),
      connections,
    };
  }

  private async getEarliestOrderDatesSafely(connectionIds: string[]): Promise<Map<string, Date>> {
    try {
      return await this.orderRecordService.getEarliestOrderDateByConnection(connectionIds);
    } catch (error) {
      this.logger.warn(
        `Failed to batch-read earliest order dates: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return new Map();
    }
  }

  private async buildTrustEntry(
    connection: Connection,
    now: Date,
    earliestOrderDates: Map<string, Date>
  ): Promise<ConnectionIngestionTrust> {
    const earliestOrderDate = earliestOrderDates.get(connection.id) ?? null;
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
      // Falls back to MIN_STALE_THRESHOLD_MS rather than leaving the
      // threshold null when the cadence is unknown — an unknown cadence is
      // not the same fact as "no threshold should ever apply," and without
      // this a webhook-first connection whose last poll succeeded months
      // ago would read 'fresh' forever.
      const staleAfterMs =
        expectedIntervalMs !== null
          ? computeStaleAfterMs(expectedIntervalMs, STALE_THRESHOLD_MULTIPLIER, MIN_STALE_THRESHOLD_MS)
          : MIN_STALE_THRESHOLD_MS;

      // A connection the platform itself has flagged unreachable is never
      // 'fresh' regardless of how recently it last polled — this overrides
      // the poll-derived classification entirely.
      const status =
        connection.status === 'active'
          ? classifyIngestionStatus(lastPollAt, staleAfterMs, now)
          : 'disconnected';

      return {
        connectionId: connection.id,
        connectionName: connection.name,
        platformType: connection.platformType,
        connectionStatus: connection.status,
        status,
        lastPollAt,
        lastOrderIngestedAt,
        connectionCreatedAt: connection.createdAt,
        earliestOrderDate,
        expectedIntervalMs,
        staleAfterMs,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to build ingestion trust entry for connection ${connection.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return this.buildDegradedEntry(connection, earliestOrderDate);
    }
  }

  private buildDegradedEntry(
    connection: Connection,
    earliestOrderDate: Date | null
  ): ConnectionIngestionTrust {
    return {
      connectionId: connection.id,
      connectionName: connection.name,
      platformType: connection.platformType,
      connectionStatus: connection.status,
      // 'unknown', never 'never-ingested' — a build failure is an
      // infrastructure fact, not a claim about the operator's data (a
      // transient repository error must not assert "this connection has
      // never ingested anything"). Outranks 'disconnected' too: the
      // failure means this entry can't even vouch for connection.status
      // being the right explanation.
      status: 'unknown',
      lastPollAt: null,
      lastOrderIngestedAt: null,
      connectionCreatedAt: connection.createdAt,
      // The job-lookup failure that lands us here is orthogonal to the
      // batched earliest-order-date lookup (#2083), which already
      // succeeded (or failed) for every connection before this method ever
      // ran — so a degraded entry still carries a real value when one is
      // available, rather than forcing null.
      earliestOrderDate,
      expectedIntervalMs: null,
      staleAfterMs: null,
    };
  }
}
