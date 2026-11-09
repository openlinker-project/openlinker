import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Select } from '../../shared/ui/select';
import { TimeDisplay } from '../../shared/ui/time-display';
import { formatDurationMs } from '../../shared/format/format-duration-ms';
import { SyncJobStatusBadge } from '../../features/sync-jobs/components/SyncJobStatusBadge';
import { useSyncJobsQuery } from '../../features/sync-jobs/hooks/use-sync-jobs-query';
import { useStreamDeadLettersQuery } from '../../features/sync-jobs/hooks/use-stream-dead-letters-query';
import { useStreamDeadLettersCountQuery } from '../../features/sync-jobs/hooks/use-stream-dead-letters-count-query';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import type {
  SyncJob,
  SyncJobFilters,
  JobOutcome,
  JobStatus,
  JobType,
} from '../../features/sync-jobs/api/sync-jobs.types';
import {
  JOB_OUTCOME_VALUES,
  JOB_STATUS_VALUES,
  JOB_TYPE_VALUES,
  SYNC_JOBS_MAX_LIMIT,
} from '../../features/sync-jobs/api/sync-jobs.types';
import type { StreamDeadLetter } from '../../features/sync-jobs/api/stream-dead-letters.types';
import { jobTypeLabel } from '../../features/sync-jobs/lib/job-type-label';
import { interpolate, useMessages, type Messages } from '../../shared/i18n';

type SyncJobsPageCopy = Messages['sync-jobs']['syncJobsPage'];

// Capped by the backend validator on GET /sync/jobs (@Max(100)).
const PAGE_SIZE = SYNC_JOBS_MAX_LIMIT;

function buildColumns(copy: SyncJobsPageCopy['columns']): DataTableColumn<SyncJob>[] {
  return [
    {
      id: 'status',
      header: copy.status,
      cell: (job) => <SyncJobStatusBadge status={job.status} outcome={job.outcome} outcomeReason={job.outcomeReason} />,
      accessor: (job) => job.status,
      sortable: true,
    },
    {
      id: 'jobType',
      header: copy.jobType,
      cell: (job) => <span title={job.jobType}>{jobTypeLabel(job.jobType)}</span>,
      accessor: (job) => job.jobType,
      sortable: true,
    },
    {
      id: 'connectionId',
      header: copy.connection,
      cell: (job) => (
        <ConnectionEntityLabel connectionId={job.connectionId} linkToDetail={false} showId />
      ),
      hideBelow: 1024,
    },
    {
      id: 'attempts',
      header: copy.attempts,
      align: 'right',
      cell: (job) => {
        const deferred = formatDurationMs(job.deferredTotalMs);
        return (
          <>
            {job.attempts} / {job.maxAttempts}
            {deferred !== null ? (
              // A deferred job consumes no attempt, so its counter stands still
              // while it waits. Without this an operator reads a row parked on a
              // throttling shop as simply stuck (#2613).
              <span className="text-muted" title={interpolate(copy.deferredTitle, { duration: deferred })}>
                {' '}
                · {copy.deferred}
              </span>
            ) : null}
          </>
        );
      },
      accessor: (job) => job.attempts,
      sortable: true,
      hideBelow: 768,
    },
    {
      id: 'lastAttemptDurationMs',
      header: copy.duration,
      align: 'right',
      // Unmeasured rows sort as -1, so they group together and land first on an
      // ascending sort - ahead of a genuine 0 ms row. Stated rather than dressed
      // up: the cell renders an em-dash, so the group is identifiable, and this
      // page sorts only the visible page anyway.
      cell: (job) => {
        const formatted = formatDurationMs(job.lastAttemptDurationMs);
        return formatted ?? <span className="text-muted">—</span>;
      },
      accessor: (job) => job.lastAttemptDurationMs ?? -1,
      sortable: true,
      hideBelow: 768,
    },
    {
      id: 'lastError',
      header: copy.lastError,
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
      header: copy.created,
      cell: (job) => <TimeDisplay iso={job.createdAt} />,
      accessor: (job) => job.createdAt,
      sortable: true,
    },
  ];
}

// Poison stream entries are rare (they only exist after MAX_RECOVERY_ATTEMPTS
// consecutive failures); a small fixed page is plenty and keeps this
// secondary table lightweight relative to the primary sync-jobs one.
const DEAD_LETTER_PAGE_SIZE = 20;

function buildDeadLetterColumns(
  copy: SyncJobsPageCopy['deadLetters']['columns'],
): DataTableColumn<StreamDeadLetter>[] {
  return [
    {
      id: 'stream',
      header: copy.stream,
      cell: (entry) => <span className="mono-text">{entry.stream}</span>,
      accessor: (entry) => entry.stream,
      sortable: true,
    },
    {
      id: 'consumerGroup',
      header: copy.consumerGroup,
      cell: (entry) => <span className="mono-text">{entry.consumerGroup}</span>,
      hideBelow: 1024,
    },
    {
      id: 'entryId',
      header: copy.entryId,
      cell: (entry) => <span className="mono-text">{entry.entryId}</span>,
      hideBelow: 768,
    },
    {
      id: 'attempts',
      header: copy.attempts,
      align: 'right',
      cell: (entry) => entry.attempts,
      accessor: (entry) => entry.attempts,
      sortable: true,
    },
    {
      id: 'lastError',
      header: copy.lastError,
      cell: (entry) => (
        <span className="mono-text" title={entry.lastError}>
          {entry.lastError.length > 60 ? `${entry.lastError.slice(0, 60)}…` : entry.lastError}
        </span>
      ),
    },
    {
      id: 'lastSeenAt',
      header: copy.lastSeen,
      cell: (entry) => <TimeDisplay iso={entry.lastSeenAt} />,
      accessor: (entry) => entry.lastSeenAt,
      sortable: true,
    },
  ];
}

/**
 * Poison Redis Stream entries that exhausted recovery (#2301, D48) — a
 * durable terminal state, so an entry whose handler always throws is a row
 * here rather than an infinitely-retried PEL entry. Read-only: no replay
 * action in this pass.
 */
function StreamDeadLettersSection(): ReactElement {
  const copy = useMessages('sync-jobs').syncJobsPage.deadLetters;
  const columns = useMemo(() => buildDeadLetterColumns(copy.columns), [copy]);
  const [offset, setOffset] = useState(0);
  const { sort, setSort } = useTableSort([{ id: 'lastSeenAt', desc: true }]);

  const countQuery = useStreamDeadLettersCountQuery();
  const listQuery = useStreamDeadLettersQuery(undefined, {
    limit: DEAD_LETTER_PAGE_SIZE,
    offset,
  });

  const total = listQuery.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + DEAD_LETTER_PAGE_SIZE < total;

  return (
    <div className="page-section" aria-labelledby="stream-dead-letters-heading">
      <h2 id="stream-dead-letters-heading" className="section-title">
        {copy.title}
        {countQuery.data ? <span className="text-muted"> ({countQuery.data.count})</span> : null}
      </h2>
      <p className="text-muted">
        {copy.description}
      </p>

      {listQuery.isLoading ? (
        <DataTableSkeleton columns={columns} label={copy.loading} />
      ) : listQuery.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={listQuery.error.message}
          action={<Button onClick={() => { void listQuery.refetch(); }}>{copy.retry}</Button>}
        />
      ) : (listQuery.data?.items.length ?? 0) === 0 ? (
        <EmptyState liveRegion="off" title={copy.empty.title} message={copy.empty.message} />
      ) : (
        <>
          <DataTable
            caption={copy.title}
            columns={columns}
            rows={listQuery.data?.items ?? []}
            rowKey={(entry) => entry.id}
            sort={sort}
            onSortChange={setSort}
          />
          <div className="pagination">
            <span className="text-muted">
              {interpolate(copy.pagination.range, {
                from: offset + 1,
                to: Math.min(offset + DEAD_LETTER_PAGE_SIZE, total),
                total,
              })}
            </span>
            <div className="pagination__actions">
              <Button disabled={!hasPrev} onClick={() => { setOffset(offset - DEAD_LETTER_PAGE_SIZE); }}>
                {copy.pagination.previous}
              </Button>
              <Button disabled={!hasNext} onClick={() => { setOffset(offset + DEAD_LETTER_PAGE_SIZE); }}>
                {copy.pagination.next}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function SyncJobsPage(): ReactElement {
  const copy = useMessages('sync-jobs').syncJobsPage;
  const statusLabels: Record<string, string | undefined> =
    useMessages('sync-jobs').syncJobStatusBadge.statuses;
  const columns = useMemo(() => buildColumns(copy.columns), [copy]);
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'createdAt', desc: true }]);

  const status = (searchParams.get('status') as JobStatus | null) ?? undefined;
  const jobType = (searchParams.get('jobType') as JobType | null) ?? undefined;
  const connectionId = searchParams.get('connectionId') ?? undefined;
  const outcome = (searchParams.get('outcome') as JobOutcome | null) ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: SyncJobFilters = { status, jobType, connectionId, outcome };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useSyncJobsQuery(filters, pagination);
  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];

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
      next.delete('outcome');
      next.delete('offset');
      return next;
    });
  }

  const filtersActive = Boolean(status || jobType || connectionId || outcome);
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      {/* Filter bar */}
      <div className="toolbar">
        <Select
          aria-label={copy.filters.status}
          value={status ?? ''}
          onChange={(e) => { setFilter('status', e.target.value); }}
        >
          <option value="">{copy.filters.allStatuses}</option>
          {JOB_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {statusLabels[s] ?? s}
            </option>
          ))}
        </Select>

        <Select
          aria-label={copy.filters.jobType}
          value={jobType ?? ''}
          onChange={(e) => { setFilter('jobType', e.target.value); }}
        >
          <option value="">{copy.filters.allJobTypes}</option>
          {JOB_TYPE_VALUES.map((t) => (
            <option key={t} value={t}>
              {jobTypeLabel(t)}
            </option>
          ))}
        </Select>

        <Select
          aria-label={copy.filters.outcome}
          value={outcome ?? ''}
          onChange={(e) => { setFilter('outcome', e.target.value); }}
        >
          <option value="">{copy.filters.allOutcomes}</option>
          {JOB_OUTCOME_VALUES.map((o) => (
            <option key={o} value={o}>
              {copy.outcomes[o]}
            </option>
          ))}
        </Select>

        <Select
          aria-label={copy.filters.connection}
          value={connectionId ?? ''}
          onChange={(e) => { setFilter('connectionId', e.target.value); }}
        >
          <option value="">{copy.filters.allConnections}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Table */}
      {query.isLoading ? (
        <DataTableSkeleton columns={columns} label={copy.loading} />
      ) : query.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>{copy.retry}</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title={copy.empty.title}
          message={
            filtersActive
              ? copy.empty.filtered
              : copy.empty.none
          }
          action={
            filtersActive ? (
              <Button onClick={clearFilters}>{copy.empty.clearFilters}</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <DataTable
            caption={copy.caption}
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(job) => job.id}
            rowHref={(job) => job.id}
            sort={sort}
            onSortChange={setSort}
            virtualize
            containerHeight={600}
            cardView={{
              title: (job) => jobTypeLabel(job.jobType),
              subtitle: (job) => (
                <ConnectionEntityLabel
                  connectionId={job.connectionId}
                  linkToDetail={false}
                  showId={false}
                />
              ),
              meta: (job) => <SyncJobStatusBadge status={job.status} outcome={job.outcome} outcomeReason={job.outcomeReason} />,
            }}
          />

          {/* Pagination */}
          <div className="pagination">
            <span className="text-muted">
              {interpolate(copy.pagination.range, {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, total),
                total,
              })}
            </span>
            <div className="pagination__actions">
              <Button
                disabled={!hasPrev}
                onClick={() => { setOffset(offset - PAGE_SIZE); }}
              >
                {copy.pagination.previous}
              </Button>
              <Button
                disabled={!hasNext}
                onClick={() => { setOffset(offset + PAGE_SIZE); }}
              >
                {copy.pagination.next}
              </Button>
            </div>
          </div>
        </>
      )}

      <StreamDeadLettersSection />
    </PageLayout>
  );
}
