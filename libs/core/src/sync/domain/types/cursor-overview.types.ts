/**
 * Cursor Overview Types (#4023)
 *
 * The read model behind the operator-facing "Sync progress" page: every
 * cursor grouped by connection, each paired with the newest run of the job
 * that advances it, plus the per-listing stock write marks as one summary.
 *
 * @module libs/core/src/sync/domain/types
 */
import type { CursorFamily, CursorRewindTarget } from './cursor-key-catalogue.types';
import type { JobOutcome, JobStatus, JobType } from './sync-job.types';

export interface CursorLastRun {
  jobId: string;
  jobType: JobType;
  status: JobStatus;
  outcome: JobOutcome | null;
  /** When the run last changed state (finished, failed, or was picked up). */
  at: Date;
  lastError: string | null;
}

export interface CursorOverviewItem {
  cursorKey: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
  /** Null for a key this build does not recognise. It is still listed. */
  family: CursorFamily | null;
  rewind: CursorRewindTarget | null;
  lastRun: CursorLastRun | null;
}

export interface CursorWriteMarksSummary {
  keyPrefix: string;
  count: number;
  oldestValue: string;
  newestValue: string;
  lastUpdatedAt: Date;
}

export interface CursorOverviewConnection {
  connectionId: string;
  cursors: CursorOverviewItem[];
  writeMarks: CursorWriteMarksSummary | null;
}

export interface CursorOverview {
  connections: CursorOverviewConnection[];
  /** True when more cursors exist than the overview read; the page says so rather than implying it saw all. */
  truncated: boolean;
}

export interface CursorRewindInput {
  connectionId: string;
  cursorKey: string;
  target: CursorRewindTarget;
}

export interface CursorRewindResult {
  connectionId: string;
  cursorKey: string;
  previousValue: string | null;
  value: string;
}
