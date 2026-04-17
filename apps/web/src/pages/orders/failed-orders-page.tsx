/**
 * Failed Orders Page
 *
 * Displays dead order-sync jobs with inline retry capability. Allows operators
 * to diagnose and remediate failed order synchronizations.
 *
 * @module apps/web/src/pages/orders
 */
import { type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { Select } from '../../shared/ui/select';
import { StatusBadge } from '../../shared/ui/status-badge';
import { useSyncJobsQuery } from '../../features/sync-jobs/hooks/use-sync-jobs-query';
import { useRetrySyncJobMutation } from '../../features/sync-jobs/hooks/use-retry-sync-job-mutation';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { useToast } from '../../shared/ui/toast-provider';
import type { SyncJob, SyncJobFilters } from '../../features/sync-jobs/api/sync-jobs.types';

const PAGE_SIZE = 25;

const ORDER_JOB_TYPES = ['marketplace.order.sync'] as const;

function RetryButton({ job }: { job: SyncJob }): ReactElement {
  const mutation = useRetrySyncJobMutation();
  const { showToast } = useToast();

  function handleRetry(): void {
    mutation.mutate(job.id, {
      onSuccess: () => {
        showToast({ tone: 'success', title: 'Retrying', description: `Job ${job.id.slice(0, 8)}… requeued.` });
      },
      onError: (error) => {
        showToast({ tone: 'error', title: 'Retry failed', description: error.message });
      },
    });
  }

  const isPending = mutation.isPending && mutation.variables === job.id;

  return (
    <Button
      onClick={handleRetry}
      disabled={isPending}
      className="button--compact"
    >
      {isPending ? 'Retrying…' : 'Retry'}
    </Button>
  );
}

function truncateError(error: string | null, maxLength = 80): string {
  if (!error) return '—';
  return error.length > maxLength ? `${error.slice(0, maxLength)}…` : error;
}

const COLUMNS: DataTableColumn<SyncJob>[] = [
  {
    id: 'id',
    header: 'Job ID',
    cell: (job) => (
      <Link to={`/sync-jobs/${job.id}`} className="mono-text">
        {job.id.slice(0, 8)}…
      </Link>
    ),
  },
  {
    id: 'connectionId',
    header: 'Connection',
    cell: (job) => <span className="mono-text">{job.connectionId.slice(0, 8)}…</span>,
  },
  {
    id: 'updatedAt',
    header: 'Failed At',
    cell: (job) => new Date(job.updatedAt).toLocaleString(),
  },
  {
    id: 'lastError',
    header: 'Error',
    cell: (job) => (
      <details>
        <summary style={{ cursor: 'pointer' }}>{truncateError(job.lastError)}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em', marginTop: '0.5rem' }}>
          {job.lastError ?? '—'}
        </pre>
      </details>
    ),
  },
  {
    id: 'attempts',
    header: 'Attempts',
    cell: (job) => `${job.attempts}/${job.maxAttempts}`,
    align: 'center',
  },
  {
    id: 'actions',
    header: '',
    cell: (job) => <RetryButton job={job} />,
    align: 'right',
  },
];

export function FailedOrdersPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const connectionId = searchParams.get('connectionId') ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: SyncJobFilters = {
    status: 'dead',
    jobType: ORDER_JOB_TYPES[0],
    connectionId: connectionId || undefined,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useSyncJobsQuery(filters, pagination);
  const connectionsQuery = useConnectionsQuery();

  function handleConnectionFilterChange(value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set('connectionId', value);
      } else {
        next.delete('connectionId');
      }
      next.delete('offset');
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

  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;
  const connections = connectionsQuery.data ?? [];

  return (
    <PageLayout
      eyebrow="Orders"
      title="Failed Orders"
      description="Order sync failures — diagnose errors and retry failed jobs."
      actions={
        <Link to="/orders" className="button button--ghost">
          ← All Orders
        </Link>
      }
    >
      {/* Filter bar */}
      <div className="toolbar">
        <Select
          aria-label="Filter by connection"
          value={connectionId ?? ''}
          onChange={(e) => { handleConnectionFilterChange(e.target.value); }}
        >
          <option value="">All connections</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        <StatusBadge tone="error" compact>
          {total} failed
        </StatusBadge>
      </div>

      {query.isLoading ? (
        <LoadingState
          liveRegion="off"
          title="Loading failed orders"
          message="Fetching failed order sync jobs…"
        />
      ) : query.error ? (
        <ErrorState
          title="Unable to load failed orders"
          message={query.error.message}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No failed orders"
          message={
            connectionId
              ? 'No failed order sync jobs for the selected connection.'
              : 'No failed order sync jobs found. All orders are syncing successfully.'
          }
        />
      ) : (
        <>
          <DataTable
            caption="Failed order sync jobs"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(job) => job.id}
          />

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
