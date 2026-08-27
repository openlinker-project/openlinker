/**
 * Connection Sync Status Service
 *
 * The per-connection sync-status read (#2615): how much work is queued for one
 * connection, whether that queue is converging, and when the connection's sync
 * state last moved. Read-only.
 *
 * It lives in `sync` rather than in a third trust context because every input
 * belongs to `sync` already - `sync_jobs`, `connection_cursors` and the pure
 * backlog rule. `analytics-trust` and `catalog-trust` exist because they
 * compose FOREIGN contexts that no single owner could answer for; a wrapper
 * context here would add a hop and own nothing.
 *
 * It resolves no adapter and makes no outbound call. That is a requirement, not
 * an optimisation: the diagnostics must answer precisely when the shop does
 * not, so nothing on this path may depend on the shop being reachable.
 *
 * All policy lives in the pure domain service, so this class only reads and
 * assembles.
 *
 * @module libs/core/src/sync/application/services
 * @implements {IConnectionSyncStatusService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { SYNC_JOB_REPOSITORY_TOKEN } from '../../sync.tokens';
import { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import { ISyncCursorsService } from './sync-cursors.service.interface';
import { SYNC_CURSORS_SERVICE_TOKEN } from '../../sync.tokens';
import type { ConnectionSyncStatus } from '../../domain/types/connection-sync-status.types';
import {
  BACKLOG_ALERT_HORIZON_MS,
  BACKLOG_OBSERVATION_WINDOW_MS,
} from '../../domain/types/connection-sync-status.types';
import { deriveBacklogSignal } from '../../domain/domain-services/connection-backlog.domain-service';
import type { IConnectionSyncStatusService } from './connection-sync-status.service.interface';

@Injectable()
export class ConnectionSyncStatusService implements IConnectionSyncStatusService {
  private readonly logger = new Logger(ConnectionSyncStatusService.name);

  constructor(
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly jobRepository: SyncJobRepositoryPort,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService
  ) {}

  async getConnectionSyncStatus(connectionId: string): Promise<ConnectionSyncStatus> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - BACKLOG_OBSERVATION_WINDOW_MS);

    const [stats, lastCursorAdvanceAt] = await Promise.all([
      this.readStatsSafely(connectionId, windowStart),
      this.readCursorSafely(connectionId),
    ]);

    if (stats === null) {
      // 'unknown', never a healthy-looking zero. A read failure is an
      // infrastructure fact and must not be dressed up as an empty queue,
      // which would tell the operator the opposite of the truth.
      return {
        connectionId,
        generatedAt: now,
        status: 'unknown',
        alerting: false,
        queuedCount: 0,
        runningCount: 0,
        deadCount: 0,
        arrivalRatePerHour: 0,
        drainRatePerHour: 0,
        alertThresholdJobs: 0,
        estimatedClearanceMs: null,
        oldestQueuedWaitMs: null,
        averageAttemptDurationMs: null,
        attemptDurationSampleSize: 0,
        lastCursorAdvanceAt,
        observationWindowMs: BACKLOG_OBSERVATION_WINDOW_MS,
        alertHorizonMs: BACKLOG_ALERT_HORIZON_MS,
      };
    }

    const signal = deriveBacklogSignal(
      stats,
      now,
      BACKLOG_OBSERVATION_WINDOW_MS,
      BACKLOG_ALERT_HORIZON_MS
    );

    return {
      connectionId,
      generatedAt: now,
      status: signal.status,
      alerting: signal.status === 'backlogged',
      queuedCount: stats.queuedCount,
      runningCount: stats.runningCount,
      deadCount: stats.deadCount,
      arrivalRatePerHour: signal.arrivalRatePerHour,
      drainRatePerHour: signal.drainRatePerHour,
      alertThresholdJobs: signal.alertThresholdJobs,
      estimatedClearanceMs: signal.estimatedClearanceMs,
      oldestQueuedWaitMs: signal.oldestQueuedWaitMs,
      averageAttemptDurationMs: stats.averageAttemptDurationMs,
      attemptDurationSampleSize: stats.attemptDurationSampleSize,
      lastCursorAdvanceAt,
      observationWindowMs: BACKLOG_OBSERVATION_WINDOW_MS,
      alertHorizonMs: BACKLOG_ALERT_HORIZON_MS,
    };
  }

  private async readStatsSafely(
    connectionId: string,
    windowStart: Date
  ): Promise<Awaited<ReturnType<SyncJobRepositoryPort['getConnectionBacklogStats']>> | null> {
    try {
      return await this.jobRepository.getConnectionBacklogStats(connectionId, windowStart);
    } catch (error) {
      this.logger.warn(
        `Could not read backlog stats for connection ${connectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async readCursorSafely(connectionId: string): Promise<Date | null> {
    // The cursor is a supplementary fact. Failing to read it must degrade this
    // one field rather than lose the backlog answer the operator came for.
    try {
      return await this.cursors.getMostRecentCursorUpdate(connectionId);
    } catch (error) {
      this.logger.warn(
        `Could not read cursor recency for connection ${connectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}
