/**
 * Cursors API Types
 *
 * Transport shapes for the cursors endpoints. `camelCase` mirrors the backend.
 *
 * @module apps/web/src/features/cursors/api
 */
export interface Cursor {
  connectionId: string;
  cursorKey: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface CursorFilters {
  connectionId?: string;
  /** Literal key prefix (#4023), e.g. the per-listing stock write marks. */
  keyPrefix?: string;
}

export interface CursorPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedCursors {
  items: Cursor[];
  total: number;
  limit: number;
  offset: number;
}

export const CursorFamilyValues = [
  'event-bookmark',
  'rolling-offset',
  'sweep-cycle',
  'completion-stamp',
  'write-order',
] as const;
export type CursorFamily = (typeof CursorFamilyValues)[number];

export const CursorRewindTargetValues = ['restart-pass', 'restart-check'] as const;
export type CursorRewindTarget = (typeof CursorRewindTargetValues)[number];

export interface CursorLastRun {
  jobId: string;
  jobType: string;
  status: 'queued' | 'running' | 'succeeded' | 'dead';
  outcome: 'ok' | 'business_failure' | null;
  at: string;
  lastError: string | null;
}

export interface CursorOverviewItem {
  cursorKey: string;
  value: string;
  createdAt: string;
  updatedAt: string;
  family: CursorFamily | null;
  rewind: CursorRewindTarget | null;
  lastRun: CursorLastRun | null;
}

export interface CursorWriteMarksSummary {
  keyPrefix: string;
  count: number;
  oldestValue: string;
  newestValue: string;
  lastUpdatedAt: string;
}

export interface CursorOverviewConnection {
  connectionId: string;
  cursors: CursorOverviewItem[];
  writeMarks: CursorWriteMarksSummary | null;
}

export interface CursorOverview {
  connections: CursorOverviewConnection[];
  truncated: boolean;
}

export interface RewindCursorInput {
  connectionId: string;
  cursorKey: string;
  target: CursorRewindTarget;
}

export interface RewindCursorResult {
  connectionId: string;
  cursorKey: string;
  previousValue: string | null;
  value: string;
}
