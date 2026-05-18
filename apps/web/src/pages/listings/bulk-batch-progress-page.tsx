/**
 * Bulk batch progress page (#741)
 *
 * Operator lands here after submitting the bulk wizard. Polls
 * `GET /listings/bulk-create/:batchId` every 5 s while non-terminal; stops
 * once status ∈ {completed, partially-failed, failed}. Surfaces aggregate
 * counts, a partially-failed banner with "Retry all failed (N)", per-record
 * statuses, and a final summary card on terminal state.
 *
 * @module apps/web/src/pages/listings
 */
import { useCallback, useMemo, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  ErrorState,
  LoadingState,
  MetricCard,
  PageLayout,
  StatusBadge,
} from '../../shared/ui';
import { useToast } from '../../shared/ui/toast-provider';
import { BulkBatchProgressTable } from '../../features/listings/components/bulk/bulk-batch-progress-table';
import { useBulkBatchQuery } from '../../features/listings/hooks/use-bulk-batch-query';
import { useBulkRetryFailedMutation } from '../../features/listings/hooks/use-bulk-retry-failed-mutation';
import { useConnectionsQuery } from '../../features/connections';
import {
  TERMINAL_BULK_BATCH_STATUSES,
  type BulkBatchStatus,
} from '../../features/listings/api/bulk-listings.types';

export function BulkBatchProgressPage(): ReactElement {
  const { batchId } = useParams<{ batchId: string }>();
  const query = useBulkBatchQuery(batchId);
  const retryMutation = useBulkRetryFailedMutation();
  const connectionsQuery = useConnectionsQuery();
  const { showToast } = useToast();

  const inProgress = useMemo(() => {
    if (!query.data) return 0;
    return (
      query.data.totalCount -
      query.data.succeededCount -
      query.data.failedCount
    );
  }, [query.data]);

  const handleRetryAll = useCallback(async () => {
    if (!batchId) return;
    try {
      const result = await retryMutation.mutateAsync(batchId);
      showToast({
        tone: 'success',
        title: 'Retry dispatched',
        description: `${result.retriedCount.toLocaleString()} records re-enqueued.`,
      });
    } catch (error) {
      showToast({
        tone: 'error',
        title: 'Retry failed',
        description: (error as Error).message,
      });
    }
  }, [batchId, retryMutation, showToast]);

  if (!batchId) {
    return (
      <ErrorState
        title="Missing batch ID"
        message="The route is missing a batch identifier."
      />
    );
  }

  if (query.isLoading) {
    return (
      <LoadingState
        title="Loading batch"
        message="Fetching bulk batch status…"
      />
    );
  }

  if (query.error) {
    return (
      <ErrorState
        title="Could not load batch"
        message={query.error.message}
        action={
          <Button onClick={() => { void query.refetch(); }}>Retry</Button>
        }
      />
    );
  }

  if (!query.data) {
    return (
      <ErrorState
        title="Batch not found"
        message={`No batch with id "${batchId}" was found.`}
      />
    );
  }

  const batch = query.data;
  const isTerminal = TERMINAL_BULK_BATCH_STATUSES.includes(batch.status);
  const connectionName =
    connectionsQuery.data?.find((c) => c.id === batch.connectionId)?.name ??
    batch.connectionId;

  const succeededPct =
    batch.totalCount > 0
      ? Math.round((batch.succeededCount / batch.totalCount) * 100)
      : 0;
  const failedPct =
    batch.totalCount > 0
      ? Math.round((batch.failedCount / batch.totalCount) * 100)
      : 0;

  const elapsed = computeElapsed(batch.createdAt, batch.updatedAt);

  return (
    <PageLayout
      eyebrow="Operations · Listings"
      title={
        <>
          Bulk batch{' '}
          <span
            className="mono-text"
            style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 500 }}
          >
            {batch.id.slice(0, 8)}
          </span>
        </>
      }
      description={
        <>
          Status <BatchStatusLabel status={batch.status} /> · {connectionName}{' '}
          · {batch.totalCount.toLocaleString()} {batch.totalCount === 1 ? 'variant' : 'variants'}
        </>
      }
      actions={
        <Link to="/listings" className="button">
          Open in /listings →
        </Link>
      }
    >
      <div className="bulk-batch__kpi-strip">
        <MetricCard
          label="Total"
          value={batch.totalCount.toLocaleString()}
          description={`Submitted ${formatRelative(batch.createdAt)}`}
        />
        <MetricCard
          label={`Succeeded · ${succeededPct.toString()}%`}
          value={batch.succeededCount.toLocaleString()}
          description="Offers live on marketplace"
          tone="success"
        />
        <MetricCard
          label={`Failed · ${failedPct.toString()}%`}
          value={batch.failedCount.toLocaleString()}
          description={batch.failedCount > 0 ? 'Retry available below' : 'No failures'}
          tone={batch.failedCount > 0 ? 'error' : 'neutral'}
        />
        <MetricCard
          label="In progress"
          value={inProgress.toLocaleString()}
          description={isTerminal ? 'Batch closed' : 'Polling every 5 s'}
          tone={inProgress > 0 ? 'info' : 'neutral'}
        />
      </div>

      {!isTerminal ? (
        <Alert tone="info">
          <strong>Batch in progress.</strong> Polling for updates every 5 seconds.
        </Alert>
      ) : null}

      {batch.status === 'partially-failed' && batch.failedCount > 0 ? (
        <Alert tone="warning">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div style={{ flex: 1 }}>
              <strong>Batch ended with {batch.failedCount.toLocaleString()} {batch.failedCount === 1 ? 'failure' : 'failures'}.</strong>{' '}
              You can retry all of them in one click — successful offers won't be touched.
            </div>
            <Button
              tone="primary"
              onClick={() => { void handleRetryAll(); }}
              disabled={retryMutation.isPending}
            >
              {retryMutation.isPending
                ? 'Retrying…'
                : `Retry all failed (${batch.failedCount.toLocaleString()})`}
            </Button>
          </div>
        </Alert>
      ) : null}

      <BulkBatchProgressTable records={batch.records} />

      {isTerminal ? (
        <div className="bulk-batch__summary">
          <div className="bulk-batch__summary-main">
            <strong>
              Batch {batch.status === 'completed' ? 'completed' : 'ended'} in {elapsed}
            </strong>{' '}
            · {batch.succeededCount.toLocaleString()} created · {batch.failedCount.toLocaleString()} failed
          </div>
          <div className="bulk-batch__summary-links">
            <Link to="/listings">Open in /listings →</Link>
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
}

function BatchStatusLabel({
  status,
}: {
  status: BulkBatchStatus;
}): ReactElement {
  switch (status) {
    case 'pending':
      return <StatusBadge tone="neutral" withDot>pending</StatusBadge>;
    case 'running':
      return <StatusBadge tone="info" withDot pulse>running</StatusBadge>;
    case 'completed':
      return <StatusBadge tone="success" withDot>completed</StatusBadge>;
    case 'partially-failed':
      return <StatusBadge tone="warning" withDot>partially failed</StatusBadge>;
    case 'failed':
      return <StatusBadge tone="error" withDot>failed</StatusBadge>;
  }
}

function computeElapsed(startIso: string, endIso: string): string {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds.toString()}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return remSeconds > 0
    ? `${minutes.toString()}m ${remSeconds.toString()}s`
    : `${minutes.toString()}m`;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds.toString()}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes.toString()} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours.toString()} h ago`;
}
