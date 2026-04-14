import { useCallback, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { useDevStackHealthQuery } from '../../features/health/hooks/use-dev-stack-health-query';
import { useSyncJobsQuery } from '../../features/sync-jobs/hooks/use-sync-jobs-query';
import type { ServiceHealth, ServiceStatus, OverallStatus } from '../../features/health/api/health.types';
import type { Connection } from '../../features/connections/api/connections.types';
import type { SyncJob } from '../../features/sync-jobs/api/sync-jobs.types';
import { Button } from '../../shared/ui/button';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';

function toStatusTone(status: string): StatusBadgeTone {
  if (status === 'active' || status === 'succeeded') return 'success';
  if (status === 'error' || status === 'dead') return 'error';
  if (status === 'running') return 'info';
  if (status === 'queued') return 'neutral';
  return 'neutral';
}

function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatJobType(jobType: string): string {
  return jobType.replaceAll('.', ' › ');
}

const jobTypeColumn: DataTableColumn<SyncJob> = {
  id: 'jobType',
  header: 'Job type',
  cell: (row) => <span className="mono-text">{formatJobType(row.jobType)}</span>,
};

const attemptsColumn: DataTableColumn<SyncJob> = {
  id: 'attempts',
  header: 'Attempts',
  align: 'center',
  cell: (row) => `${row.attempts}/${row.maxAttempts}`,
};

const updatedAtColumn: DataTableColumn<SyncJob> = {
  id: 'updatedAt',
  header: 'Updated',
  align: 'right',
  cell: (row) => <span className="muted-text">{formatRelativeTime(row.updatedAt)}</span>,
};

const recentJobColumns: DataTableColumn<SyncJob>[] = [
  jobTypeColumn,
  {
    id: 'status',
    header: 'Status',
    cell: (row) => (
      <StatusBadge tone={toStatusTone(row.status)} compact>
        {row.status}
      </StatusBadge>
    ),
  },
  attemptsColumn,
  updatedAtColumn,
];

const failedJobColumns: DataTableColumn<SyncJob>[] = [
  jobTypeColumn,
  {
    id: 'lastError',
    header: 'Error',
    cell: (row) => (
      <span className="muted-text" title={row.lastError ?? undefined}>
        {row.lastError ? (row.lastError.length > 60 ? `${row.lastError.slice(0, 60)}…` : row.lastError) : '—'}
      </span>
    ),
  },
  attemptsColumn,
  updatedAtColumn,
];

function toHealthTone(status: ServiceStatus | OverallStatus): StatusBadgeTone {
  if (status === 'ok') return 'success';
  if (status === 'warning' || status === 'degraded') return 'warning';
  return 'error';
}

function ServiceHealthRow({ name, health }: { name: string; health: ServiceHealth }): ReactElement {
  return (
    <li>
      <strong>{name}</strong>
      <StatusBadge tone={toHealthTone(health.status)}>
        {health.status}
      </StatusBadge>
      {health.message ? <span className="muted-text">{health.message}</span> : null}
    </li>
  );
}

function ConnectionHealthList({ connections }: { connections: Connection[] }): ReactElement {
  if (connections.length === 0) {
    return (
      <p className="muted-text">
        No connections configured.{' '}
        <Link to="/connections/new">Add the first connection.</Link>
      </p>
    );
  }
  return (
    <ul className="check-list">
      {connections.map((c) => (
        <li key={c.id}>
          <strong>{c.name}</strong>
          <StatusBadge tone={toStatusTone(c.status)} withDot>
            {c.status}
          </StatusBadge>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage(): ReactElement {
  const connectionsQuery = useConnectionsQuery();
  const healthQuery = useDevStackHealthQuery();
  const recentJobsQuery = useSyncJobsQuery(undefined, { limit: 5 });
  const queuedJobsQuery = useSyncJobsQuery({ status: 'queued' }, { limit: 1 });
  const deadJobsQuery = useSyncJobsQuery({ status: 'dead' }, { limit: 10 });

  const connections = connectionsQuery.data ?? [];
  const activeCount = connections.filter((c) => c.status === 'active').length;
  const errorCount = connections.filter((c) => c.status === 'error').length;

  const deadCount = deadJobsQuery.data?.total ?? 0;
  const queuedCount = queuedJobsQuery.data?.total ?? 0;

  const isFetching = connectionsQuery.isFetching || healthQuery.isFetching
    || recentJobsQuery.isFetching || queuedJobsQuery.isFetching || deadJobsQuery.isFetching;

  const handleRefresh = useCallback((): void => {
    void connectionsQuery.refetch();
    void healthQuery.refetch();
    void recentJobsQuery.refetch();
    void queuedJobsQuery.refetch();
    void deadJobsQuery.refetch();
  }, [connectionsQuery, healthQuery, recentJobsQuery, queuedJobsQuery, deadJobsQuery]);

  return (
    <PageLayout
      eyebrow="Overview"
      title="Operations overview"
      description="Monitor integration health, dependency status, and connection activity from one command surface."
      actions={
        <Button onClick={handleRefresh} disabled={isFetching}>
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      }
    >
      {/* ── Metric strip ─────────────────────────────────────────── */}
      <section className="status-strip">
        <article className={errorCount > 0 ? 'metric-card metric-card--warning' : 'metric-card'}>
          <span className="metric-card__label">Integration health</span>
          {connectionsQuery.isLoading ? (
            <strong className="metric-card__value">—</strong>
          ) : (
            <strong className="metric-card__value">{activeCount} / {connections.length}</strong>
          )}
          <p>{errorCount > 0 ? `${errorCount} connection${errorCount > 1 ? 's' : ''} in error` : 'All channels active'}</p>
        </article>

        <article className="metric-card">
          <span className="metric-card__label">System health</span>
          {healthQuery.isLoading ? (
            <strong className="metric-card__value">—</strong>
          ) : healthQuery.error ? (
            <strong className="metric-card__value">!</strong>
          ) : (
            <strong className="metric-card__value">
              <StatusBadge tone={toHealthTone(healthQuery.data?.status ?? 'error')}>
                {healthQuery.data?.status ?? 'unknown'}
              </StatusBadge>
            </strong>
          )}
          <p>Postgres · Redis · PrestaShop · Worker</p>
        </article>

        <article className={deadCount > 0 ? 'metric-card metric-card--warning' : 'metric-card'}>
          <span className="metric-card__label">Failed jobs</span>
          {deadJobsQuery.isLoading ? (
            <strong className="metric-card__value">—</strong>
          ) : (
            <strong className="metric-card__value">{deadCount}</strong>
          )}
          <p>{deadCount > 0 ? `${deadCount} job${deadCount === 1 ? '' : 's'} need${deadCount === 1 ? 's' : ''} attention` : 'No failures'}</p>
        </article>

        <article className="metric-card">
          <span className="metric-card__label">Queued jobs</span>
          {queuedJobsQuery.isLoading ? (
            <strong className="metric-card__value">—</strong>
          ) : (
            <strong className="metric-card__value">{queuedCount}</strong>
          )}
          <p>{queuedCount > 0 ? `${queuedCount} job${queuedCount > 1 ? 's' : ''} waiting` : 'Queue empty'}</p>
        </article>
      </section>

      <div className="workspace-grid workspace-grid--primary">
        {/* ── Integration health ───────────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Integrations</p>
              <h3 className="section-title">Connection health</h3>
            </div>
            <span className="panel__meta">
              {connectionsQuery.isLoading ? '…' : `${connections.length} configured`}
            </span>
          </div>

          {connectionsQuery.isLoading && (
            <LoadingState title="Loading connections" message="Fetching connection status…" liveRegion="off" />
          )}
          {connectionsQuery.error && (
            <ErrorState
              title="Unable to load connections"
              message={connectionsQuery.error.message}
              action={<Button onClick={() => void connectionsQuery.refetch()}>Retry</Button>}
            />
          )}
          {!connectionsQuery.isLoading && !connectionsQuery.error && (
            <ConnectionHealthList connections={connections} />
          )}
        </article>

        {/* ── System health ─────────────────────────────────────────── */}
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Infrastructure</p>
              <h3 className="section-title">System health</h3>
            </div>
            {healthQuery.data && (
              <StatusBadge tone={toHealthTone(healthQuery.data.status)}>
                {healthQuery.data.status}
              </StatusBadge>
            )}
          </div>

          {healthQuery.isLoading && (
            <LoadingState title="Checking system health" message="Pinging dependencies…" liveRegion="off" />
          )}
          {healthQuery.error && (
            <ErrorState
              title="Health check failed"
              message={healthQuery.error.message}
              action={<Button onClick={() => void healthQuery.refetch()}>Retry</Button>}
            />
          )}
          {healthQuery.data && (
            <ul className="check-list">
              <ServiceHealthRow name="PostgreSQL" health={healthQuery.data.services.postgres} />
              <ServiceHealthRow name="Redis" health={healthQuery.data.services.redis} />
              <ServiceHealthRow name="PrestaShop" health={healthQuery.data.services.prestashop} />
              {healthQuery.data.services.worker && (
                <ServiceHealthRow name="Worker" health={healthQuery.data.services.worker} />
              )}
            </ul>
          )}
        </article>
      </div>

      {/* ── Sync job panels ────────────────────────────────────────── */}
      <div className="workspace-grid">
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Activity</p>
              <h3 className="section-title">Recent sync jobs</h3>
            </div>
            <span className="panel__meta">
              {recentJobsQuery.isLoading ? '…' : `${recentJobsQuery.data?.total ?? 0} total`}
            </span>
          </div>

          {recentJobsQuery.isLoading && (
            <LoadingState title="Loading sync jobs" message="Fetching recent activity…" liveRegion="off" />
          )}
          {recentJobsQuery.error && (
            <ErrorState
              title="Unable to load sync jobs"
              message={recentJobsQuery.error.message}
              action={<Button onClick={() => void recentJobsQuery.refetch()}>Retry</Button>}
            />
          )}
          {!recentJobsQuery.isLoading && !recentJobsQuery.error && (
            <DataTable
              caption="Recent sync jobs"
              columns={recentJobColumns}
              rows={recentJobsQuery.data?.items ?? []}
              rowKey={(row) => row.id}
              emptyState={<p className="muted-text">No sync jobs recorded yet.</p>}
            />
          )}
        </article>

        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Failures</p>
              <h3 className="section-title">Failed jobs</h3>
            </div>
            {deadCount > 0 && (
              <StatusBadge tone="error" compact>{deadCount} failed</StatusBadge>
            )}
          </div>

          {deadJobsQuery.isLoading && (
            <LoadingState title="Loading failed jobs" message="Checking for failures…" liveRegion="off" />
          )}
          {deadJobsQuery.error && (
            <ErrorState
              title="Unable to load failed jobs"
              message={deadJobsQuery.error.message}
              action={<Button onClick={() => void deadJobsQuery.refetch()}>Retry</Button>}
            />
          )}
          {!deadJobsQuery.isLoading && !deadJobsQuery.error && (
            <DataTable
              caption="Failed sync jobs"
              columns={failedJobColumns}
              rows={deadJobsQuery.data?.items ?? []}
              rowKey={(row) => row.id}
              emptyState={<p className="muted-text">No failed jobs. All clear.</p>}
            />
          )}
        </article>
      </div>
    </PageLayout>
  );
}
