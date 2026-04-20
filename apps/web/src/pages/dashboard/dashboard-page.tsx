/**
 * Dashboard Page — Operations overview
 *
 * Triage-first dashboard. KPI strip + "What's broken right now" pattern +
 * connection health roll-up. Failed-jobs KPI links to `/jobs-logs?status=dead`
 * and the grouped triage surface exposes Retry / View actions per group.
 *
 * @module pages/dashboard
 */
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { useDevStackHealthQuery } from '../../features/health/hooks/use-dev-stack-health-query';
import { useSyncJobsQuery } from '../../features/sync-jobs/hooks/use-sync-jobs-query';
import { useRetrySyncJobMutation } from '../../features/sync-jobs/hooks/use-retry-sync-job-mutation';
import type {
  ServiceHealth,
  ServiceStatus,
  OverallStatus,
} from '../../features/health/api/health.types';
import type { Connection, ConnectionStatus } from '../../features/connections/api/connections.types';
import type { JobStatus, SyncJob } from '../../features/sync-jobs/api/sync-jobs.types';
import { DASHBOARD_HEALTH_INTERVAL_MS, DASHBOARD_JOBS_INTERVAL_MS } from './intervals';
import {
  groupFailedJobs,
  summarizeFailuresByConnection,
  type ConnectionFailureSignal,
  type FailedJobGroup,
} from './failed-job-groups';
import { Button } from '../../shared/ui/button';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { MetricCard, MetricCardLink } from '../../shared/ui/metric-card';
import { PageLayout } from '../../shared/ui/page-layout';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useToast } from '../../shared/ui/toast-provider';

// Client-side grouping caps at 500 dead jobs. Beyond that we still render the
// aggregate count correctly (via `total`), but the grouped rows fall back to
// "first 500 shown" semantics. Operators running 500+ simultaneous dead jobs
// have a bigger problem than dashboard pagination.
const DEAD_JOB_GROUPING_LIMIT = 500;

type DashboardTone = 'success' | 'warning' | 'error' | 'neutral';

function toRowStatusTone(status: ConnectionStatus | JobStatus): DashboardTone {
  if (status === 'active' || status === 'succeeded') return 'success';
  if (status === 'error' || status === 'dead') return 'error';
  return 'neutral';
}

function mapHealthTone(
  status: ServiceStatus | OverallStatus | undefined,
  hasError: boolean,
): DashboardTone {
  if (hasError || status === 'error') return 'error';
  if (status === 'warning' || status === 'degraded') return 'warning';
  if (status === 'ok') return 'success';
  return 'neutral';
}

function toHealthLabel(status: OverallStatus | undefined): string {
  if (status === 'ok') return 'OK';
  if (status === 'degraded') return 'Degraded';
  if (status === 'error') return 'Error';
  return 'Unknown';
}

function formatJobType(jobType: string): string {
  return jobType.replaceAll('.', ' › ');
}

function renderHealthValue(
  status: OverallStatus | undefined,
  isLoading: boolean,
  hasError: boolean,
): string {
  if (isLoading) return '—';
  if (hasError) return 'Unreachable';
  return toHealthLabel(status);
}

function ServiceHealthRow({ name, health }: { name: string; health: ServiceHealth }): ReactElement {
  return (
    <li>
      <strong>{name}</strong>
      <StatusBadge tone={mapHealthTone(health.status, false)}>{health.status}</StatusBadge>
      {health.message ? <span className="muted-text">{health.message}</span> : null}
    </li>
  );
}

interface RolledUpConnection {
  connection: Connection;
  deadJobCount: number;
  rollupTone: DashboardTone;
}

function rollUpConnectionHealth(
  connections: Connection[],
  failureSignals: Map<string, ConnectionFailureSignal>,
): RolledUpConnection[] {
  return connections.map((connection) => {
    const deadJobCount = failureSignals.get(connection.id)?.deadJobCount ?? 0;
    let rollupTone: DashboardTone = toRowStatusTone(connection.status);
    // Job-signal roll-up: even if the DB row still says `active`, a connection
    // that is spilling dead jobs is not healthy. This replaces the
    // reassuring "All channels active" message with something actionable.
    if (connection.status !== 'error' && deadJobCount > 0) {
      rollupTone = 'warning';
    }
    return { connection, deadJobCount, rollupTone };
  });
}

function ConnectionHealthList({ rows }: { rows: RolledUpConnection[] }): ReactElement {
  if (rows.length === 0) {
    return (
      <p className="muted-text">
        No connections configured.{' '}
        <Link to="/connections/new">Add the first connection.</Link>
      </p>
    );
  }
  return (
    <ul className="check-list">
      {rows.map(({ connection, deadJobCount, rollupTone }) => (
        <li key={connection.id}>
          <strong>{connection.name}</strong>
          <StatusBadge tone={rollupTone} withDot>
            {connection.status}
          </StatusBadge>
          {deadJobCount > 0 ? (
            <Link
              className="muted-text"
              to={`/jobs-logs?status=dead&connectionId=${encodeURIComponent(connection.id)}`}
            >
              {deadJobCount} failing job{deadJobCount === 1 ? '' : 's'}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage(): ReactElement {
  const connectionsQuery = useConnectionsQuery(undefined, { refetchInterval: DASHBOARD_HEALTH_INTERVAL_MS });
  const healthQuery = useDevStackHealthQuery({ refetchInterval: DASHBOARD_HEALTH_INTERVAL_MS });
  const recentJobsQuery = useSyncJobsQuery(undefined, { limit: 5 }, { refetchInterval: DASHBOARD_JOBS_INTERVAL_MS });
  const queuedJobsQuery = useSyncJobsQuery({ status: 'queued' }, { limit: 1 }, { refetchInterval: DASHBOARD_JOBS_INTERVAL_MS });
  const deadJobsQuery = useSyncJobsQuery(
    { status: 'dead' },
    { limit: DEAD_JOB_GROUPING_LIMIT },
    { refetchInterval: DASHBOARD_JOBS_INTERVAL_MS },
  );
  const retrySyncJob = useRetrySyncJobMutation();
  const { showToast } = useToast();
  // Per-group pending state. Retry disables only its own row button so an
  // operator can fire retries against different groups in parallel without
  // the whole table freezing on a shared mutation flag.
  const [pendingGroupKey, setPendingGroupKey] = useState<string | null>(null);

  const connections = connectionsQuery.data ?? [];
  const deadJobs = useMemo<SyncJob[]>(() => deadJobsQuery.data?.items ?? [], [deadJobsQuery.data]);
  const failureSignals = useMemo(() => summarizeFailuresByConnection(deadJobs), [deadJobs]);
  const rolledUpConnections = useMemo(
    () => rollUpConnectionHealth(connections, failureSignals),
    [connections, failureSignals],
  );
  const failedGroups = useMemo(() => groupFailedJobs(deadJobs), [deadJobs]);

  const activeCount = connections.filter((c) => c.status === 'active').length;
  const errorCount = connections.filter((c) => c.status === 'error').length;
  const warningCount = rolledUpConnections.filter((r) => r.rollupTone === 'warning').length;
  const deadTotal = deadJobsQuery.data?.total ?? 0;
  const queuedTotal = queuedJobsQuery.data?.total ?? 0;

  const integrationTone: DashboardTone =
    errorCount > 0 ? 'warning' : warningCount > 0 ? 'warning' : 'neutral';
  const integrationDescription =
    errorCount > 0
      ? `${errorCount} connection${errorCount > 1 ? 's' : ''} in error`
      : warningCount > 0
        ? `${warningCount} connection${warningCount > 1 ? 's' : ''} with failing jobs`
        : 'All channels active';

  const isFetching =
    connectionsQuery.isFetching ||
    healthQuery.isFetching ||
    recentJobsQuery.isFetching ||
    queuedJobsQuery.isFetching ||
    deadJobsQuery.isFetching;

  function handleRefresh(): void {
    void connectionsQuery.refetch();
    void healthQuery.refetch();
    void recentJobsQuery.refetch();
    void queuedJobsQuery.refetch();
    void deadJobsQuery.refetch();
  }

  const connectionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of connections) m.set(c.id, c.name);
    return m;
  }, [connections]);

  const handleRetryGroup = useCallback(
    async (group: FailedJobGroup): Promise<void> => {
      setPendingGroupKey(group.key);
      try {
        await retrySyncJob.mutateAsync(group.representative.id);
        // The backend retry endpoint is per-job, so we only re-queue the
        // representative (most recently updated) row in the group. Surface
        // that honestly so an operator doesn't assume all N just re-ran.
        const remaining = Math.max(0, group.count - 1);
        showToast({
          tone: 'success',
          title: 'Re-queued 1 job',
          description:
            remaining === 0
              ? `${formatJobType(group.jobType)} will re-run.`
              : `${formatJobType(group.jobType)} — most recent job re-queued. ${remaining} other failure${remaining === 1 ? '' : 's'} still dead; open View jobs to retry the rest.`,
        });
      } catch (error) {
        showToast({
          tone: 'error',
          title: 'Retry failed',
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        setPendingGroupKey((current) => (current === group.key ? null : current));
      }
    },
    [retrySyncJob, showToast],
  );

  const failedGroupColumns: DataTableColumn<FailedJobGroup>[] = useMemo(
    () => [
      {
        id: 'jobType',
        header: 'Job type',
        cell: (group) => <span className="mono-text">{formatJobType(group.jobType)}</span>,
      },
      {
        id: 'connection',
        header: 'Connection',
        cell: (group) => (
          <span>{connectionNameById.get(group.connectionId) ?? group.connectionId}</span>
        ),
        hideBelow: 768,
      },
      {
        id: 'count',
        header: 'Failures',
        align: 'right',
        cell: (group) => (
          <StatusBadge tone="error" compact>
            {group.count}
          </StatusBadge>
        ),
      },
      {
        id: 'lastError',
        header: 'Last error',
        cell: (group) => (
          <span className="muted-text" title={group.lastError ?? undefined}>
            {group.lastError
              ? group.lastError.length > 80
                ? `${group.lastError.slice(0, 80)}…`
                : group.lastError
              : '—'}
          </span>
        ),
        hideBelow: 1024,
      },
      {
        id: 'updatedAt',
        header: 'Latest',
        align: 'right',
        cell: (group) => (
          <TimeDisplay iso={group.latestUpdatedAt} format="relative" className="muted-text" />
        ),
        hideBelow: 768,
      },
      {
        id: 'actions',
        header: 'Actions',
        align: 'right',
        cell: (group): ReactElement => {
          const connectionName = connectionNameById.get(group.connectionId) ?? group.connectionId;
          const signature = `${formatJobType(group.jobType)} on ${connectionName}`;
          const retryLabel = group.count > 1 ? `Retry 1 of ${group.count}` : 'Retry';
          return (
            <div className="dashboard-incidents__actions">
              <Button
                tone="secondary"
                onClick={() => void handleRetryGroup(group)}
                disabled={pendingGroupKey === group.key}
                aria-label={`${retryLabel} — ${signature}`}
              >
                {pendingGroupKey === group.key ? 'Retrying…' : retryLabel}
              </Button>
              <Link
                className="button button--ghost"
                to={`/jobs-logs?status=dead&connectionId=${encodeURIComponent(group.connectionId)}&jobType=${encodeURIComponent(group.jobType)}`}
                aria-label={`View jobs — ${signature}`}
              >
                View jobs
              </Link>
            </div>
          );
        },
      },
    ],
    [connectionNameById, handleRetryGroup, pendingGroupKey],
  );

  const recentJobColumns: DataTableColumn<SyncJob>[] = useMemo(
    () => [
      {
        id: 'jobType',
        header: 'Job type',
        cell: (job) => <span className="mono-text">{formatJobType(job.jobType)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        cell: (job) => (
          <StatusBadge tone={toRowStatusTone(job.status)} compact>
            {job.status}
          </StatusBadge>
        ),
      },
      {
        id: 'attempts',
        header: 'Attempts',
        align: 'center',
        cell: (job) => `${job.attempts}/${job.maxAttempts}`,
        hideBelow: 768,
      },
      {
        id: 'updatedAt',
        header: 'Updated',
        align: 'right',
        cell: (job) => (
          <TimeDisplay iso={job.updatedAt} format="relative" className="muted-text" />
        ),
      },
    ],
    [],
  );

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
      {/* ── KPI strip ────────────────────────────────────────────── */}
      <section className="status-strip">
        <MetricCard
          label="Integration health"
          value={connectionsQuery.isLoading ? '—' : `${activeCount} / ${connections.length}`}
          tone={integrationTone}
          description={integrationDescription}
        />

        <MetricCard
          label="System health"
          value={renderHealthValue(
            healthQuery.data?.status,
            healthQuery.isLoading,
            Boolean(healthQuery.error),
          )}
          tone={mapHealthTone(healthQuery.data?.status, Boolean(healthQuery.error))}
          description="Postgres · Redis · PrestaShop · Worker"
        />

        {deadTotal > 0 ? (
          <MetricCardLink
            label="Failed jobs"
            value={deadTotal}
            tone="error"
            to="/jobs-logs?status=dead"
            description={`${deadTotal} job${deadTotal === 1 ? '' : 's'} need${deadTotal === 1 ? 's' : ''} attention`}
          />
        ) : (
          <MetricCard
            label="Failed jobs"
            value={deadJobsQuery.isLoading ? '—' : 0}
            tone="neutral"
            description="No failures"
          />
        )}

        {queuedTotal > 0 ? (
          <MetricCardLink
            label="Queued jobs"
            value={queuedTotal}
            tone="neutral"
            to="/jobs-logs?status=queued"
            description={`${queuedTotal} job${queuedTotal > 1 ? 's' : ''} waiting`}
          />
        ) : (
          <MetricCard
            label="Queued jobs"
            value={queuedJobsQuery.isLoading ? '—' : 0}
            tone="neutral"
            description="Queue empty"
          />
        )}
      </section>

      {/* ── What's broken right now (primary triage surface) ──────── */}
      <article className="panel panel--dense dashboard-incidents">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Incidents</p>
            <h3 className="section-title">What&rsquo;s broken right now</h3>
          </div>
          {deadTotal > 0 ? (
            <span className="panel__meta">
              {deadJobs.length < deadTotal
                ? `${failedGroups.length} signatures in first ${deadJobs.length}`
                : `${failedGroups.length} unique signature${failedGroups.length === 1 ? '' : 's'}`}
              {' · '}
              {deadTotal} total failure{deadTotal === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>

        {deadJobsQuery.isLoading ? (
          <LoadingState title="Loading failures" message="Collecting dead jobs…" liveRegion="off" />
        ) : deadJobsQuery.error ? (
          <ErrorState
            title="Unable to load failures"
            message={deadJobsQuery.error.message}
            action={<Button onClick={() => void deadJobsQuery.refetch()}>Retry</Button>}
          />
        ) : (
          <DataTable
            caption="Failed sync jobs grouped by connection and job type"
            columns={failedGroupColumns}
            rows={failedGroups}
            rowKey={(group) => group.key}
            cardView={{
              title: (group) => (
                <span className="mono-text">{formatJobType(group.jobType)}</span>
              ),
              subtitle: (group) => (
                <span>
                  {connectionNameById.get(group.connectionId) ?? group.connectionId} ·{' '}
                  {group.count} failure{group.count === 1 ? '' : 's'}
                </span>
              ),
              meta: (group) => (
                <StatusBadge tone="error" compact>
                  {group.count}
                </StatusBadge>
              ),
            }}
            emptyState={
              <p className="muted-text">No failed jobs. All clear.</p>
            }
          />
        )}
      </article>

      {/* ── Connection + system health ───────────────────────────── */}
      <div className="workspace-grid workspace-grid--primary">
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
            <ConnectionHealthList rows={rolledUpConnections} />
          )}
        </article>

        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Infrastructure</p>
              <h3 className="section-title">System health</h3>
            </div>
            {healthQuery.data && (
              <StatusBadge tone={mapHealthTone(healthQuery.data.status, false)}>
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

      {/* ── Recent activity (secondary) ──────────────────────────── */}
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
    </PageLayout>
  );
}
