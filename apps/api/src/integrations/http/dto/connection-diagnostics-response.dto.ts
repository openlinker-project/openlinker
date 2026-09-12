/**
 * Connection Diagnostics Response DTO
 *
 * Aggregated operational summary for a single connection. Combines connection
 * status with recent sync job activity to give the FE a single read endpoint
 * for per-connection diagnostics.
 *
 * **`lastSucceededAt` / `lastFailedAt` are NOT `sync_jobs`-only (#3179).** A
 * document registration IS activity on the connection whether or not the
 * `sync_jobs` row that dispatched it still sits inside this read's own
 * 10-row recency window, and a connection that has genuinely registered
 * documents must never read "Never" - the unqualified claim this DTO makes,
 * unlike `ConnectionSyncStatusPanel`'s honestly-windowed "None in the last
 * week". `fromDomain` therefore folds in the connection's own
 * `FiscalRegistrationRecord` / `InvoiceRecord` history alongside the sync-job
 * one and reports whichever source observed the most recent success/failure.
 * The `recentJobs` table stays `sync_jobs`-only - it is a job-orchestration
 * view, not a document ledger.
 *
 * **The three reads are independently fallible, and a failure must never
 * read as a confirmed zero.** The controller reads sync jobs, fiscal
 * registrations and invoices via `Promise.allSettled` rather than
 * `Promise.all` (#3179) — a fiscalization- or invoicing-table outage must
 * not take down the whole diagnostics panel the way it would if any one of
 * the three `Promise.all` legs rejected. A rejected read is folded in as `[]`
 * (no observations lost from it, because there were none to lose) and its
 * source is named in `unreadableSources`, so the FE can distinguish three
 * states behind a `null` timestamp: genuinely no activity
 * (`unreadableSources` empty), versus "we could not fully check"
 * (`unreadableSources` non-empty) — the `analytics-trust` /
 * `catalog-trust` / `sync-status` precedent of a distinct `unknown` rather
 * than a silently healthy-looking zero.
 *
 * @module apps/api/src/integrations/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { FiscalRegistrationRecord } from '@openlinker/core/fiscalization';
import type { InvoiceRecord } from '@openlinker/core/invoicing';

/**
 * The three independently-read activity sources {@link
 * ConnectionDiagnosticsResponseDto} folds together. Named here (rather than
 * left as ad hoc strings) so `unreadableSources` carries a closed,
 * FE-narrowable vocabulary.
 */
export const ConnectionDiagnosticsSourceValues = [
  'syncJobs',
  'fiscalRegistrations',
  'invoices',
] as const;
export type ConnectionDiagnosticsSource = (typeof ConnectionDiagnosticsSourceValues)[number];

export class RecentJobSummaryDto {
  @ApiProperty({ description: 'Job UUID' })
  id!: string;

  @ApiProperty({ description: 'Job type identifier' })
  jobType!: string;

  @ApiProperty({ description: 'Job status', example: 'succeeded' })
  status!: string;

  @ApiProperty({ description: 'Number of execution attempts' })
  attempts!: number;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt!: string;

  @ApiProperty({ description: 'Last error message, if any', nullable: true })
  lastError!: string | null;
}

/** One (timestamp, message) observation, from whichever source produced it. */
interface Observation {
  at: Date;
  message: string | null;
}

export class ConnectionDiagnosticsResponseDto {
  @ApiProperty({ description: 'Connection UUID' })
  connectionId!: string;

  @ApiProperty({ description: 'Human-readable connection name' })
  connectionName!: string;

  @ApiProperty({ description: 'Connection status', example: 'active' })
  connectionStatus!: string;

  @ApiProperty({
    description:
      'Timestamp of the last succeeded activity on this connection (ISO 8601), or null if none. ' +
      'Considers sync jobs AND any document (invoice / fiscal receipt) this connection has ' +
      'registered, whichever is more recent.',
    nullable: true,
  })
  lastSucceededAt!: string | null;

  @ApiProperty({
    description:
      'Timestamp of the last failed activity on this connection (ISO 8601), or null if none. ' +
      'Considers sync jobs AND any document (invoice / fiscal receipt) this connection has ' +
      'failed to register, whichever is more recent.',
    nullable: true,
  })
  lastFailedAt!: string | null;

  @ApiProperty({ description: 'Error messages from recent failed activity', type: [String] })
  recentErrors!: string[];

  @ApiProperty({ description: 'Last 10 sync jobs for this connection, newest first', type: [RecentJobSummaryDto] })
  recentJobs!: RecentJobSummaryDto[];

  @ApiProperty({
    description:
      'Which of the three activity sources (sync jobs, fiscal registrations, invoices) could ' +
      'NOT be read for this response. A non-empty list means lastSucceededAt / lastFailedAt / ' +
      'recentErrors are computed from the remaining, readable sources only - a null timestamp ' +
      'here is NOT a confirmed absence of activity and must not be rendered as "Never".',
    type: [String],
    enum: ConnectionDiagnosticsSourceValues,
    isArray: true,
  })
  unreadableSources!: ConnectionDiagnosticsSource[];

  static fromDomain(
    connection: Connection,
    recentJobs: SyncJob[],
    recentFiscalRegistrations: FiscalRegistrationRecord[] = [],
    recentInvoices: InvoiceRecord[] = [],
    unreadableSources: ConnectionDiagnosticsSource[] = [],
  ): ConnectionDiagnosticsResponseDto {
    const dto = new ConnectionDiagnosticsResponseDto();
    dto.connectionId = connection.id;
    dto.connectionName = connection.name;
    dto.connectionStatus = connection.status;

    const succeededJobs = recentJobs.filter((j) => j.status === 'succeeded');
    // 'failed' status is never written — markFailed() re-queues jobs as 'queued'.
    // Capture dead jobs and any retrying job that has a recorded error.
    const failedJobs = recentJobs.filter((j) => j.status === 'dead' || j.lastError !== null);

    const succeeded: Observation[] = succeededJobs.map((j) => ({
      at: new Date(j.updatedAt),
      message: null,
    }));
    const failed: Observation[] = failedJobs.map((j) => ({
      at: new Date(j.updatedAt),
      message: j.lastError ?? null,
    }));

    for (const record of recentFiscalRegistrations) {
      if (record.status === 'registered') {
        succeeded.push({ at: record.registeredAt ?? record.updatedAt, message: null });
      } else if (record.status === 'failed') {
        failed.push({ at: record.updatedAt, message: record.failureReason ?? null });
      }
    }

    for (const record of recentInvoices) {
      if (record.status === 'issued') {
        succeeded.push({ at: record.issuedAt ?? record.updatedAt, message: null });
      } else if (record.status === 'failed') {
        failed.push({ at: record.updatedAt, message: record.failureReason ?? null });
      }
    }

    dto.lastSucceededAt = mostRecent(succeeded)?.at.toISOString() ?? null;
    dto.lastFailedAt = mostRecent(failed)?.at.toISOString() ?? null;

    dto.recentErrors = failed
      .map((f) => f.message)
      .filter((message): message is string => message !== null && message !== undefined);

    dto.recentJobs = recentJobs.map((j) => {
      const jobDto = new RecentJobSummaryDto();
      jobDto.id = j.id;
      jobDto.jobType = j.jobType;
      jobDto.status = j.status;
      jobDto.attempts = j.attempts;
      jobDto.createdAt = new Date(j.createdAt).toISOString();
      jobDto.updatedAt = new Date(j.updatedAt).toISOString();
      jobDto.lastError = j.lastError ?? null;
      return jobDto;
    });

    dto.unreadableSources = unreadableSources;

    return dto;
  }
}

/** The observation with the latest `at`, or `undefined` for an empty list. */
function mostRecent(observations: Observation[]): Observation | undefined {
  return observations.reduce<Observation | undefined>((latest, current) => {
    if (latest === undefined || current.at.getTime() > latest.at.getTime()) {
      return current;
    }
    return latest;
  }, undefined);
}
