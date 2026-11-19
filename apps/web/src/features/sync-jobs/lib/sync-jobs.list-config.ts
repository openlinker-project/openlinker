/**
 * Sync Jobs list config (#4241)
 *
 * What the Jobs table declares to the saved-views engine: the filters a view may
 * carry, the built-in views (a log has no custom views, only these), the sorts
 * and the column registry. The API has no sort for jobs, so the page orders the
 * rows it already holds; `sortSyncJobs` is that ordering, kept beside the sort
 * keys it answers to.
 *
 * Cell renderers belong to the page, so the registry is a factory taking them.
 *
 * @module apps/web/src/features/sync-jobs/lib
 */
import type { ReactNode } from 'react';
import type { ListRegistry, SystemViewDef, ViewHeaderContext, ViewSort } from '../../saved-views';
import { withColumnLayout } from '../../saved-views';
import {
  JOB_OUTCOME_VALUES,
  JOB_STATUS_VALUES,
  JOB_TYPE_VALUES,
  type SyncJob,
} from '../api/sync-jobs.types';

/** Sort keys are the column ids the table used before views, so an old `?sort=` link keeps working. */
export const SYNC_JOB_SORT_KEYS = ['status', 'jobType', 'attempts', 'lastAttemptDurationMs', 'createdAt'] as const;

/** Breakpoints the table already hid these columns at; the registry has none, so the page re-applies them. */
const SYNC_JOB_COLUMN_HIDE_BELOW: Readonly<Record<string, 480 | 768 | 1024 | 1280>> = {
  connectionId: 1024,
  attempts: 768,
  lastAttemptDurationMs: 1280,
  lastError: 1024,
};

export interface SyncJobsListConfigInput {
  labels: {
    status: string;
    statusFields: string;
    jobType: string;
    jobTypeFields: string;
    connection: string;
    attempts: string;
    duration: string;
    lastError: string;
    created: string;
  };
  viewNames: { all: string; dead: string; running: string; queued: string; businessFailures: string };
  sortLabels: {
    createdNewest: string;
    createdOldest: string;
    status: string;
    jobType: string;
    attempts: string;
    duration: string;
  };
  /** The locked Status header carries its own sort button, so it is built from the engine's header context. */
  lockedHeader: (context: ViewHeaderContext) => ReactNode;
  cells: {
    status: (row: SyncJob) => ReactNode;
    jobType: (row: SyncJob) => ReactNode;
    connection: (row: SyncJob) => ReactNode;
    attempts: (row: SyncJob) => ReactNode;
    duration: (row: SyncJob) => ReactNode;
    lastError: (row: SyncJob) => ReactNode;
    created: (row: SyncJob) => ReactNode;
  };
}

export function syncJobsSystemViews(names: SyncJobsListConfigInput['viewNames']): SystemViewDef[] {
  return [
    { id: 'all', name: names.all, query: '' },
    { id: 'dead', name: names.dead, query: 'status=dead', tone: 'error' },
    { id: 'running', name: names.running, query: 'status=running' },
    { id: 'queued', name: names.queued, query: 'status=queued' },
    { id: 'business-failures', name: names.businessFailures, query: 'outcome=business_failure', tone: 'warning' },
  ];
}

export function createSyncJobsListRegistry(input: SyncJobsListConfigInput): ListRegistry<SyncJob> {
  const { labels, cells } = input;
  return {
    pageKey: 'sync-jobs',
    locked: {
      id: 'status',
      label: labels.status,
      description: labels.statusFields,
      header: input.lockedHeader,
      sortKeys: ['status'],
      render: cells.status,
    },
    columns: withColumnLayout([
      { id: 'jobType', label: labels.jobType, description: labels.jobTypeFields, defaultVisible: true, header: labels.jobType, sortKey: 'jobType', render: cells.jobType },
      { id: 'connectionId', label: labels.connection, defaultVisible: true, header: labels.connection, render: cells.connection },
      { id: 'attempts', label: labels.attempts, defaultVisible: true, align: 'right', header: labels.attempts, sortKey: 'attempts', render: cells.attempts },
      { id: 'lastAttemptDurationMs', label: labels.duration, defaultVisible: true, align: 'right', header: labels.duration, sortKey: 'lastAttemptDurationMs', render: cells.duration },
      { id: 'lastError', label: labels.lastError, defaultVisible: true, header: labels.lastError, render: cells.lastError },
      { id: 'createdAt', label: labels.created, defaultVisible: true, header: labels.created, sortKey: 'createdAt', render: cells.created },
    ], { hideBelow: SYNC_JOB_COLUMN_HIDE_BELOW }),
    filters: [
      { key: 'status', parse: (raw) => (JOB_STATUS_VALUES as readonly string[]).includes(raw) },
      { key: 'jobType', parse: (raw) => (JOB_TYPE_VALUES as readonly string[]).includes(raw) },
      { key: 'outcome', parse: (raw) => (JOB_OUTCOME_VALUES as readonly string[]).includes(raw) },
      { key: 'connectionId' },
    ],
    sorts: [
      { key: 'createdAt', dir: 'desc', label: input.sortLabels.createdNewest },
      { key: 'createdAt', dir: 'asc', label: input.sortLabels.createdOldest },
      { key: 'status', dir: 'asc', label: input.sortLabels.status },
      { key: 'jobType', dir: 'asc', label: input.sortLabels.jobType },
      { key: 'attempts', dir: 'desc', label: input.sortLabels.attempts },
      { key: 'lastAttemptDurationMs', dir: 'desc', label: input.sortLabels.duration },
    ],
    defaultSort: { key: 'createdAt', dir: 'desc' },
    systemViews: syncJobsSystemViews(input.viewNames),
    // A log is opened at an incident, not daily: it keeps the built-in views and nothing saved.
    customViews: false,
  };
}

function sortValue(job: SyncJob, key: string): string | number {
  switch (key) {
    case 'status':
      return job.status;
    case 'jobType':
      return job.jobType;
    case 'attempts':
      return job.attempts;
    // Unmeasured rows sort as -1 so they group together ahead of a genuine 0 ms row.
    case 'lastAttemptDurationMs':
      return job.lastAttemptDurationMs ?? -1;
    default:
      return job.createdAt;
  }
}

/** The rows in the view's order; the API offers no sort, so this orders the page already fetched. */
export function sortSyncJobs(rows: readonly SyncJob[], sort: ViewSort): SyncJob[] {
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left === right) return 0;
    return (left < right ? -1 : 1) * factor;
  });
}
