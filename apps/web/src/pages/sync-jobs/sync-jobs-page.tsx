import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { TimeDisplay } from '../../shared/ui/time-display';
import { SyncJobStatusBadge } from '../../features/sync-jobs/components/SyncJobStatusBadge';
import { useSyncJobsQuery } from '../../features/sync-jobs/hooks/use-sync-jobs-query';
import type { SyncJob, SyncJobFilters, JobStatus, JobType } from '../../features/sync-jobs/api/sync-jobs.types';
import {
  JOB_STATUS_VALUES,
  JOB_TYPE_VALUES,
  SYNC_JOBS_MAX_LIMIT,
} from '../../features/sync-jobs/api/sync-jobs.types';

// Capped by the backend validator on GET /sync/jobs (@Max(100)).
const PAGE_SIZE = SYNC_JOBS_MAX_LIMIT;

const COLUMNS: DataTableColumn<SyncJob>[] = [
  {
    id: 'status',
    header: 'Status',
    cell: (job) => <SyncJobStatusBadge status={job.status} />,
    accessor: (job) => job.status,
    sortable: true,
  },
  {
    id: 'jobType',
    header: 'Job type',
    cell: (job) => (
      <span className="mono-text" title={job.jobType}>
        {job.jobType}
      </span>
    ),
    accessor: (job) => job.jobType,
    sortable: true,
  },
  {
    id: 'connectionId',
    header: 'Connection',
    cell: (job) => (
      <span className="mono-text" title={job.connectionId}>
        {job.connectionId}
      </span>
    ),
    hideBelow: 1024,
  },
  {
    id: 'attempts',
    header: 'Attempts',
    align: 'right',
    cell: (job) => `${job.attempts} / ${job.maxAttempts}`,
    accessor: (job) => job.attempts,
    sortable: true,
    hideBelow: 768,
  },
  {
    id: 'lastError',
    header: 'Last error',
    cell: (job) =>
      job.lastError ? (
        <span className="mono-text" title={job.lastError}>
          {job.lastError.length > 60 ? `${job.lastError.slice(0, 60)}…` : job.lastError}
        </span>
      ) : (
        <span className="text-muted">—</span>
      ),
    hideBelow: 1024,
  },
  {
    id: 'createdAt',
    header: 'Created',
    cell: (job) => <TimeDisplay iso={job.createdAt} />,
    accessor: (job) => job.createdAt,
    sortable: true,
  },
];

export function SyncJobsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'createdAt', desc: true }]);

  const status = (searchParams.get('status') as JobStatus | null) ?? undefined;
  const jobType = (searchParams.get('jobType') as JobType | null) ?? undefined;
  const connectionId = searchParams.get('connectionId') ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: SyncJobFilters = { status, jobType, connectionId };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useSyncJobsQuery(filters, pagination);

  function setFilter(key: string, value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.delete('offset'); // reset pagination on filter change
      return next;
    });
  }

  function setOffset(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) {
        p.delete('offset');
      } else {
        p.set('offset', String(next));
      }
      return p;
    });
  }

  function clearFilters(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('status');
      next.delete('jobType');
      next.delete('connectionId');
      next.delete('offset');
      return next;
    });
  }

  const filtersActive = Boolean(status || jobType || connectionId);
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageLayout
      eyebrow="Diagnostics"
      title="Sync Jobs"
      description="Background processing visibility — filter by status, job type, or connection."
    >
      {/* Filter bar */}
      <div className="toolbar">
        <select
          aria-label="Filter by status"
          value={status ?? ''}
          onChange={(e) => { setFilter('status', e.target.value); }}
        >
          <option value="">All statuses</option>
          {JOB_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by job type"
          value={jobType ?? ''}
          onChange={(e) => { setFilter('jobType', e.target.value); }}
        >
          <option value="">All job types</option>
          {JOB_TYPE_VALUES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <input
          aria-label="Filter by connection ID"
          placeholder="Connection ID"
          value={connectionId ?? ''}
          onChange={(e) => { setFilter('connectionId', e.target.value); }}
        />
      </div>

      {/* Table */}
      {query.isLoading ? (
        <DataTableSkeleton columns={COLUMNS} />
      ) : query.error ? (
        <ErrorState
          title="Unable to load sync jobs"
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No jobs found"
          message={
            filtersActive
              ? 'No jobs match the current filters.'
              : 'No sync jobs have been enqueued yet.'
          }
          action={
            filtersActive ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <DataTable
            caption="Sync jobs"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(job) => job.id}
            rowHref={(job) => job.id}
            sort={sort}
            onSortChange={setSort}
            virtualize
            containerHeight={600}
            cardView={{
              title: (job) => job.jobType,
              subtitle: (job) => job.connectionId,
              meta: (job) => <SyncJobStatusBadge status={job.status} />,
            }}
          />

          {/* Pagination */}
          <div className="pagination">
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="pagination__actions">
              <Button
                disabled={!hasPrev}
                onClick={() => { setOffset(offset - PAGE_SIZE); }}
              >
                Previous
              </Button>
              <Button
                disabled={!hasNext}
                onClick={() => { setOffset(offset + PAGE_SIZE); }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
