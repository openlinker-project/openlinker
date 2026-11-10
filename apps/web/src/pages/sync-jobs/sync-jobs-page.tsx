import type { ReactElement } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { describeApiError } from '../../shared/api/describe-api-error';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Select } from '../../shared/ui/select';
import { TimeDisplay } from '../../shared/ui/time-display';
import { EmptyValue } from '../../shared/ui/empty-value';
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
import { interpolate, useMessages, type Messages, type ResolvedCopy } from '../../shared/i18n';
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

// Capped by the backend validator on GET /sync/jobs (@Max(100)).
const PAGE_SIZE = SYNC_JOBS_MAX_LIMIT;

type SyncJobsCopy = ResolvedCopy<Messages['sync-jobs']>['syncJobsPage'];

/** Breaks a dotted code only after a dot, never inside a segment. */
function DottedCode({ code }: { code: string }): ReactElement {
  return (
    <>
      {code.split('.').map((segment, i) => (
        <span key={i}>
          {i > 0 ? '.' : ''}
          {i > 0 ? <wbr /> : null}
          {segment}
        </span>
      ))}
    </>
  );
}

/**
 * The job type as two lines. When the type has an operator-facing name
 * (`jobTypeLabel`), that name leads and the full code sits under it; when it
 * has none, the code's last segment - the part that says what the job does -
 * leads and its namespace sits under it. Either way nothing is clipped: the
 * column used to cut the whole string to `fulfillment.work.au…` (#4016).
 */
function JobTypeCell({ jobType }: { jobType: string }): ReactElement {
  const label = jobTypeLabel(jobType);
  const named = label !== jobType;
  const cut = jobType.lastIndexOf('.');
  const lead = named ? label : cut === -1 ? jobType : jobType.slice(cut + 1);
  const sub = named ? jobType : cut === -1 ? null : jobType.slice(0, cut);
  return (
    <span className={`sync-job-type${named ? ' sync-job-type--named' : ''}`} title={jobType}>
      <span className="sr-only">{named ? `${label} (${jobType})` : jobType}</span>
      <span className="sync-job-type__action" aria-hidden="true">
        {lead}
      </span>
      {sub ? (
        <span className="sync-job-type__scope" aria-hidden="true">
          <DottedCode code={sub} />
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
  const copy = useMessages('sync-jobs').syncJobsPage.errorToggle;
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
          {open ? copy.showLess : copy.showFull}
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
  renderConnection: (connectionId: string) => ReactElement,
  copy: SyncJobsCopy
): DataTableColumn<SyncJob>[] {
  return [
    {
      id: 'status',
      header: copy.columns.status,
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
      header: copy.columns.jobType,
      cell: (job) => <JobTypeCell jobType={job.jobType} />,
      accessor: (job) => job.jobType,
      sortable: true,
    },
    {
      id: 'connectionId',
      header: copy.columns.connection,
      cell: (job) => renderConnection(job.connectionId),
      hideBelow: 1024,
    },
    {
      id: 'attempts',
      header: copy.columns.attempts,
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
              <span
                className="text-muted"
                title={interpolate(copy.columns.deferredTitle, { duration: deferred })}
              >
                {' '}
                · {copy.columns.deferred}
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
      header: copy.columns.duration,
      align: 'right',
      // Unmeasured rows sort as -1, so they group together and land first on an
      // ascending sort - ahead of a genuine 0 ms row. Stated rather than dressed
      // up: the cell renders the shared empty-value mark, so the group is
      // identifiable, and this page sorts only the visible page anyway.
      cell: (job) => {
        const formatted = formatDurationMs(job.lastAttemptDurationMs);
        return formatted ?? <EmptyValue />;
      },
      accessor: (job) => job.lastAttemptDurationMs ?? -1,
      sortable: true,
      // The first column to go on a mid-width window: the detail page has it.
      hideBelow: 1280,
    },
    {
      id: 'lastError',
      header: copy.columns.lastError,
      cell: (job) => (job.lastError ? <LastErrorCell error={job.lastError} /> : <EmptyValue />),
      hideBelow: 1024,
    },
    {
      id: 'createdAt',
      header: copy.columns.created,
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
  copy: SyncJobsCopy['deadLetters']['columns']
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
  const pageCopy = useMessages('sync-jobs').syncJobsPage;
  const copy = pageCopy.deadLetters;
  const deadLetterColumns = useMemo(() => buildDeadLetterColumns(copy.columns), [copy.columns]);
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
            {copy.title}
            {countQuery.data && countQuery.data.count > 0 ? (
              <span className="text-muted"> ({countQuery.data.count})</span>
            ) : null}
          </h2>
          <p className="poison-entries__hint">{copy.description}</p>
        </div>
        {isEmpty ? (
          <span className="poison-entries__none" data-testid="poison-entries-none">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="m3.5 8.5 3 3 6-7" />
            </svg>
            {copy.none}
          </span>
        ) : null}
      </div>

      {listQuery.isLoading ? (
        <DataTableSkeleton columns={deadLetterColumns} label={copy.loading} />
      ) : listQuery.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={describeApiError(listQuery.error, 'sync-jobs')}
          action={
            <Button
              onClick={() => {
                void listQuery.refetch();
              }}
            >
              {pageCopy.retry}
            </Button>
          }
        />
      ) : isEmpty ? null : (
        <>
          <DataTable
            caption={copy.title}
            columns={deadLetterColumns}
            rows={listQuery.data?.items ?? []}
            rowKey={(entry) => entry.id}
            sort={sort}
            onSortChange={setSort}
          />
          <div className="pagination">
            <span className="text-muted">
              {interpolate(pageCopy.pagination.range, {
                from: offset + 1,
                to: Math.min(offset + DEAD_LETTER_PAGE_SIZE, total),
                total,
              })}
            </span>
            <div className="pagination__actions">
              <Button
                tone="secondary"
                disabled={!hasPrev}
                onClick={() => {
                  setOffset(offset - DEAD_LETTER_PAGE_SIZE);
                }}
              >
                {pageCopy.pagination.previous}
              </Button>
              <Button
                tone="secondary"
                disabled={!hasNext}
                onClick={() => {
                  setOffset(offset + DEAD_LETTER_PAGE_SIZE);
                }}
              >
                {pageCopy.pagination.next}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function SyncJobsPage(): ReactElement {
  const copy = useMessages('sync-jobs').syncJobsPage;
  const pageCopy = copy;
  const statusLabels: Record<string, string | undefined> =
    useMessages('sync-jobs').syncJobStatusBadge.statuses;
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
  const columns = useMemo(() => buildColumns(renderConnection, copy), [renderConnection, copy]);

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
    <PageLayout eyebrow={copy.eyebrow} title={copy.title} description={copy.description}>
      {/* Filter bar - labelled, grouped on the left, wrapping (#4016). */}
      <div className="sync-jobs-filters" role="group" aria-label={copy.filters.group}>
        <div className="sync-jobs-filters__field">
          <label htmlFor="sync-jobs-filter-status">{copy.filters.status}</label>
          <Select
            id="sync-jobs-filter-status"
            className={status ? 'control--active' : ''}
            value={status ?? ''}
            onChange={(e) => {
              setFilter('status', e.target.value);
            }}
          >
            <option value="">{copy.filters.allStatuses}</option>
            {JOB_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s] ?? s}
              </option>
            ))}
          </Select>
        </div>

        <div className="sync-jobs-filters__field sync-jobs-filters__field--wide">
          <label htmlFor="sync-jobs-filter-type">{copy.filters.jobType}</label>
          <Select
            id="sync-jobs-filter-type"
            className={jobType ? 'control--active' : ''}
            value={jobType ?? ''}
            onChange={(e) => {
              setFilter('jobType', e.target.value);
            }}
          >
            <option value="">{copy.filters.allJobTypes}</option>
            {JOB_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {jobTypeLabel(t)}
              </option>
            ))}
          </Select>
        </div>

        <div className="sync-jobs-filters__field">
          <label htmlFor="sync-jobs-filter-outcome">{copy.filters.outcome}</label>
          <Select
            id="sync-jobs-filter-outcome"
            className={outcome ? 'control--active' : ''}
            value={outcome ?? ''}
            onChange={(e) => {
              setFilter('outcome', e.target.value);
            }}
          >
            <option value="">{copy.filters.allOutcomes}</option>
            {JOB_OUTCOME_VALUES.map((o) => (
              <option key={o} value={o}>
                {copy.outcomes[o]}
              </option>
            ))}
          </Select>
        </div>

        <div className="sync-jobs-filters__field">
          <label htmlFor="sync-jobs-filter-connection">{copy.filters.connection}</label>
          <Select
            id="sync-jobs-filter-connection"
            className={connectionId ? 'control--active' : ''}
            value={connectionId ?? ''}
            onChange={(e) => {
              setFilter('connectionId', e.target.value);
            }}
          >
            <option value="">{copy.filters.allConnections}</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        {filtersActive ? (
          <Button tone="ghost" className="sync-jobs-filters__clear" onClick={clearFilters}>
            {copy.empty.clearFilters}
          </Button>
        ) : null}
      </div>

      {/* Table */}
      {query.isLoading ? (
        <DataTableSkeleton columns={columns} label={copy.loading} />
      ) : query.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={describeApiError(query.error, 'sync-jobs')}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              {pageCopy.retry}
            </Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title={copy.empty.title}
          message={filtersActive ? copy.empty.filtered : copy.empty.none}
          // No action here: the filter bar's Clear filters button is already on
          // screen whenever a filter is active, and a second button with the
          // same name read twice to a screen reader (#4016).
        />
      ) : (
        <>
          {/* Not virtualized: the virtualizer pins every row to one fixed
              height and the container to 600px, which left a tall empty box
              under a short result and cannot hold a two-line job type or an
              expanded error. A page is capped at 100 rows (#4016). */}
          <DataTable
            caption={copy.caption}
            className="sync-jobs-table"
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(job) => job.id}
            rowHref={(job) => job.id}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (job) => jobTypeLabel(job.jobType),
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
              {interpolate(copy.pagination.range, {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, total),
                total,
              })}
            </span>
            <div className="pagination__actions">
              <Button
                tone="secondary"
                disabled={!hasPrev}
                onClick={() => {
                  setOffset(offset - PAGE_SIZE);
                }}
              >
                {pageCopy.pagination.previous}
              </Button>
              <Button
                tone="secondary"
                disabled={!hasNext}
                onClick={() => {
                  setOffset(offset + PAGE_SIZE);
                }}
              >
                {pageCopy.pagination.next}
              </Button>
            </div>
          </div>
        </>
      )}

      <StreamDeadLettersSection />
    </PageLayout>
  );
}
