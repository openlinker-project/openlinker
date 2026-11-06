import type { ReactElement } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import {
  ConnectionChip,
  readConnectionEnvironment,
  useConnectionsQuery,
  type Connection,
} from '../../features/connections';
import { resolvePlatformLabel, resolvePlatformShortLabel } from '../../features/mappings';
import { usePlatforms, type Platform } from '../../shared/plugins';
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

// Capped by the backend validator on GET /sync/jobs (@Max(100)).
const PAGE_SIZE = SYNC_JOBS_MAX_LIMIT;

/**
 * Splits a dotted job type into the action an operator scans for (last
 * segment) and the namespace it belongs to. The column used to clip the
 * whole string to `fulfillment.work.au…`, cutting off exactly the part that
 * says what the job does (#4016).
 */
function JobTypeCell({ jobType }: { jobType: string }): ReactElement {
  const cut = jobType.lastIndexOf('.');
  const action = cut === -1 ? jobType : jobType.slice(cut + 1);
  const scope = cut === -1 ? null : jobType.slice(0, cut);
  return (
    <span className="sync-job-type" title={jobType}>
      <span className="sr-only">{jobType}</span>
      <span className="sync-job-type__action" aria-hidden="true">
        {action}
      </span>
      {scope ? (
        <span className="sync-job-type__scope" aria-hidden="true">
          {/* Break only after a dot, never inside a segment. */}
          {scope.split('.').map((segment, i) => (
            <span key={i}>
              {i > 0 ? '.' : ''}
              {i > 0 ? <wbr /> : null}
              {segment}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Last error, clamped to two lines with an in-place toggle for the rest. The
 * toggle is a real button, which `DataTable` already excludes from the row's
 * navigate-on-click, so expanding an error does not open the job.
 *
 * Whether the toggle is needed is MEASURED, not guessed from the length: the
 * clamp depends on the column's width, so a fixed character threshold left
 * a clipped error with no way to read it on a narrower window.
 */
function LastErrorCell({ error }: { error: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || open) return undefined;
    const measure = (): void => {
      setClipped(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [error, open]);

  return (
    <span className="sync-job-error">
      <span
        ref={textRef}
        className={`sync-job-error__text${open ? ' sync-job-error__text--open' : ''}`}
      >
        {error}
      </span>
      {open || clipped ? (
        <button
          type="button"
          className="sync-job-error__toggle"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {open ? 'Show less' : 'Show full error'}
        </button>
      ) : null}
    </span>
  );
}

/**
 * The job's connection as the shared `ConnectionChip` (#3670), the chip the
 * Orders and Products lists render. Fed from the page's one batched
 * connections read rather than a fetch per row, and used by both the table
 * cell and the mobile card so the two cannot drift apart.
 */
function JobConnectionChip({
  connectionId,
  connectionById,
  connectionsLoading,
  platforms,
}: {
  connectionId: string;
  connectionById: ReadonlyMap<string, Connection>;
  connectionsLoading: boolean;
  platforms: readonly Platform[];
}): ReactElement {
  const connection = connectionById.get(connectionId);
  const platformType = connection?.platformType ?? null;
  return (
    <ConnectionChip
      connectionId={connectionId}
      name={connection?.name ?? null}
      loading={connectionsLoading}
      channel={{
        platformType,
        label: platformType ? resolvePlatformLabel(platforms, platformType) : null,
        shortLabel: platformType ? resolvePlatformShortLabel(platforms, platformType) : null,
        environment: readConnectionEnvironment(connection?.config),
      }}
    />
  );
}

function buildColumns(
  renderConnection: (connectionId: string) => ReactElement
): DataTableColumn<SyncJob>[] {
  return [
    {
      id: 'status',
      header: 'Status',
      cell: (job) => (
        <SyncJobStatusBadge
          status={job.status}
          outcome={job.outcome}
          outcomeReason={job.outcomeReason}
        />
      ),
      accessor: (job) => job.status,
      sortable: true,
    },
    {
      id: 'jobType',
      header: 'Job type',
      cell: (job) => <JobTypeCell jobType={job.jobType} />,
      accessor: (job) => job.jobType,
      sortable: true,
    },
    {
      id: 'connectionId',
      header: 'Connection',
      cell: (job) => renderConnection(job.connectionId),
      hideBelow: 1024,
    },
    {
      id: 'attempts',
      header: 'Attempts',
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
              <span className="text-muted" title={`Deferred for ${deferred} so far`}>
                {' '}
                · deferred
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
      header: 'Duration',
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
      // The first column to go on a mid-width window: the detail page has it.
      hideBelow: 1280,
    },
    {
      id: 'lastError',
      header: 'Last error',
      cell: (job) =>
        job.lastError ? (
          <LastErrorCell error={job.lastError} />
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
}

// Poison stream entries are rare (they only exist after MAX_RECOVERY_ATTEMPTS
// consecutive failures); a small fixed page is plenty and keeps this
// secondary table lightweight relative to the primary sync-jobs one.
const DEAD_LETTER_PAGE_SIZE = 20;

const DEAD_LETTER_COLUMNS: DataTableColumn<StreamDeadLetter>[] = [
  {
    id: 'stream',
    header: 'Stream',
    cell: (entry) => <span className="mono-text">{entry.stream}</span>,
    accessor: (entry) => entry.stream,
    sortable: true,
  },
  {
    id: 'consumerGroup',
    header: 'Consumer group',
    cell: (entry) => <span className="mono-text">{entry.consumerGroup}</span>,
    hideBelow: 1024,
  },
  {
    id: 'entryId',
    header: 'Entry ID',
    cell: (entry) => <span className="mono-text">{entry.entryId}</span>,
    hideBelow: 768,
  },
  {
    id: 'attempts',
    header: 'Attempts',
    align: 'right',
    cell: (entry) => entry.attempts,
    accessor: (entry) => entry.attempts,
    sortable: true,
  },
  {
    id: 'lastError',
    header: 'Last error',
    cell: (entry) => (
      <span className="mono-text" title={entry.lastError}>
        {entry.lastError.length > 60 ? `${entry.lastError.slice(0, 60)}…` : entry.lastError}
      </span>
    ),
  },
  {
    id: 'lastSeenAt',
    header: 'Last seen',
    cell: (entry) => <TimeDisplay iso={entry.lastSeenAt} />,
    accessor: (entry) => entry.lastSeenAt,
    sortable: true,
  },
];

/**
 * Poison Redis Stream entries that exhausted recovery (#2301, D48) — a
 * durable terminal state, so an entry whose handler always throws is a row
 * here rather than an infinitely-retried PEL entry. Read-only: no replay
 * action in this pass.
 */
function StreamDeadLettersSection(): ReactElement {
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
  // Nothing dead-lettered is the normal state, so it gets one line rather than
  // a heading, a paragraph and an empty-state card (#4016).
  const isEmpty =
    !listQuery.isLoading && !listQuery.error && (listQuery.data?.items.length ?? 0) === 0;

  return (
    <section className="poison-entries" aria-labelledby="stream-dead-letters-heading">
      <div className="poison-entries__header">
        <div className="poison-entries__intro">
          <h2 id="stream-dead-letters-heading" className="poison-entries__title">
            Poison stream entries
            {countQuery.data && countQuery.data.count > 0 ? (
              <span className="text-muted"> ({countQuery.data.count})</span>
            ) : null}
          </h2>
          <p className="poison-entries__hint">
            Events that failed recovery repeatedly and were recorded here instead of retrying
            forever. There is no replay action yet, so read the raw fields to investigate.
          </p>
        </div>
        {isEmpty ? (
          <span className="poison-entries__none" data-testid="poison-entries-none">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="m3.5 8.5 3 3 6-7" />
            </svg>
            None recorded
          </span>
        ) : null}
      </div>

      {listQuery.isLoading ? (
        <DataTableSkeleton columns={DEAD_LETTER_COLUMNS} label="Loading poison stream entries…" />
      ) : listQuery.error ? (
        <ErrorState
          title="Unable to load poison stream entries"
          message={listQuery.error.message}
          action={
            <Button
              onClick={() => {
                void listQuery.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      ) : isEmpty ? null : (
        <>
          <DataTable
            caption="Poison stream entries"
            columns={DEAD_LETTER_COLUMNS}
            rows={listQuery.data?.items ?? []}
            rowKey={(entry) => entry.id}
            sort={sort}
            onSortChange={setSort}
          />
          <div className="pagination">
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + DEAD_LETTER_PAGE_SIZE, total)} of {total}
            </span>
            <div className="pagination__actions">
              <Button
                tone="secondary"
                disabled={!hasPrev}
                onClick={() => {
                  setOffset(offset - DEAD_LETTER_PAGE_SIZE);
                }}
              >
                Previous
              </Button>
              <Button
                tone="secondary"
                disabled={!hasNext}
                onClick={() => {
                  setOffset(offset + DEAD_LETTER_PAGE_SIZE);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function SyncJobsPage(): ReactElement {
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
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const platforms = usePlatforms();
  const connectionById = useMemo(
    () => new Map(connections.map((c) => [c.id, c] as const)),
    [connections]
  );
  const connectionsLoading = connectionsQuery.isLoading;
  const renderConnection = useCallback(
    (id: string): ReactElement => (
      <JobConnectionChip
        connectionId={id}
        connectionById={connectionById}
        connectionsLoading={connectionsLoading}
        platforms={platforms}
      />
    ),
    [connectionById, connectionsLoading, platforms]
  );
  const columns = useMemo(() => buildColumns(renderConnection), [renderConnection]);

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
      eyebrow="Diagnostics"
      title="Sync Jobs"
      description="Background work OpenLinker runs for your connections. Filter to find what stopped."
    >
      {/* Filter bar - labelled, grouped on the left, wrapping (#4016). */}
      <div className="sync-jobs-filters" role="group" aria-label="Filter sync jobs">
        <div className="sync-jobs-filters__field">
          <label htmlFor="sync-jobs-filter-status">Status</label>
          <Select
            id="sync-jobs-filter-status"
            className={status ? 'control--active' : ''}
            value={status ?? ''}
            onChange={(e) => {
              setFilter('status', e.target.value);
            }}
          >
            <option value="">All statuses</option>
            {JOB_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>

        <div className="sync-jobs-filters__field sync-jobs-filters__field--wide">
          <label htmlFor="sync-jobs-filter-type">Job type</label>
          <Select
            id="sync-jobs-filter-type"
            className={jobType ? 'control--active' : ''}
            value={jobType ?? ''}
            onChange={(e) => {
              setFilter('jobType', e.target.value);
            }}
          >
            <option value="">All job types</option>
            {JOB_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>

        <div className="sync-jobs-filters__field">
          <label htmlFor="sync-jobs-filter-outcome">Outcome</label>
          <Select
            id="sync-jobs-filter-outcome"
            className={outcome ? 'control--active' : ''}
            value={outcome ?? ''}
            onChange={(e) => {
              setFilter('outcome', e.target.value);
            }}
          >
            <option value="">All outcomes</option>
            {JOB_OUTCOME_VALUES.map((o) => (
              <option key={o} value={o}>
                {o === 'business_failure' ? 'business failure' : o}
              </option>
            ))}
          </Select>
        </div>

        <div className="sync-jobs-filters__field">
          <label htmlFor="sync-jobs-filter-connection">Connection</label>
          <Select
            id="sync-jobs-filter-connection"
            className={connectionId ? 'control--active' : ''}
            value={connectionId ?? ''}
            onChange={(e) => {
              setFilter('connectionId', e.target.value);
            }}
          >
            <option value="">All connections</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        {filtersActive ? (
          <Button tone="ghost" className="sync-jobs-filters__clear" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {/* Table */}
      {query.isLoading ? (
        <DataTableSkeleton columns={columns} label="Loading sync jobs…" />
      ) : query.error ? (
        <ErrorState
          title="Unable to load sync jobs"
          message={query.error.message}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              Retry
            </Button>
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
          action={filtersActive ? <Button onClick={clearFilters}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          {/* Not virtualized: the virtualizer pins every row to one fixed
              height and the container to 600px, which left a tall empty box
              under a short result and cannot hold a two-line job type or an
              expanded error. A page is capped at 100 rows (#4016). */}
          <DataTable
            caption="Sync jobs"
            className="sync-jobs-table"
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(job) => job.id}
            rowHref={(job) => job.id}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (job) => job.jobType,
              subtitle: (job) => renderConnection(job.connectionId),
              meta: (job) => (
                <SyncJobStatusBadge
                  status={job.status}
                  outcome={job.outcome}
                  outcomeReason={job.outcomeReason}
                />
              ),
            }}
          />

          {/* Pagination */}
          <div className="pagination">
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="pagination__actions">
              <Button
                tone="secondary"
                disabled={!hasPrev}
                onClick={() => {
                  setOffset(offset - PAGE_SIZE);
                }}
              >
                Previous
              </Button>
              <Button
                tone="secondary"
                disabled={!hasNext}
                onClick={() => {
                  setOffset(offset + PAGE_SIZE);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <StreamDeadLettersSection />
    </PageLayout>
  );
}
