import { useCallback, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { useDevStackHealthQuery } from '../../features/health/hooks/use-dev-stack-health-query';
import type { OverallStatus, ServiceHealth } from '../../features/health/api/health.types';
import type { Connection } from '../../features/connections/api/connections.types';
import { Button } from '../../shared/ui/button';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';

function toStatusTone(status: string): StatusBadgeTone {
  if (status === 'active') return 'success';
  if (status === 'error') return 'error';
  return 'neutral';
}

function toHealthTone(status: OverallStatus): StatusBadgeTone {
  if (status === 'ok') return 'success';
  if (status === 'degraded') return 'warning';
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

  const connections = connectionsQuery.data ?? [];
  const activeCount = connections.filter((c) => c.status === 'active').length;
  const errorCount = connections.filter((c) => c.status === 'error').length;

  const handleRefresh = useCallback((): void => {
    void connectionsQuery.refetch();
    void healthQuery.refetch();
  }, [connectionsQuery.refetch, healthQuery.refetch]);

  return (
    <PageLayout
      eyebrow="Overview"
      title="Operations overview"
      description="Monitor integration health, dependency status, and connection activity from one command surface."
      actions={
        <Button onClick={handleRefresh} disabled={connectionsQuery.isFetching || healthQuery.isFetching}>
          {connectionsQuery.isFetching || healthQuery.isFetching ? 'Refreshing…' : 'Refresh'}
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
          <p>Postgres · Redis · PrestaShop</p>
        </article>

        <article className="metric-card">
          <span className="metric-card__label">Jobs needing attention</span>
          <strong className="metric-card__value">—</strong>
          <p className="muted-text">Visible once sync job monitoring is enabled</p>
        </article>

        <article className="metric-card">
          <span className="metric-card__label">Manual reviews</span>
          <strong className="metric-card__value">—</strong>
          <p className="muted-text">Visible once sync job monitoring is enabled</p>
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
            </ul>
          )}
        </article>
      </div>

      {/* ── Placeholder panels ───────────────────────────────────────── */}
      <div className="workspace-grid">
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Activity</p>
              <h3 className="section-title">Recent sync events</h3>
            </div>
            <span className="toolbar-chip">Coming soon</span>
          </div>
          <p className="muted-text panel-copy">
            Sync job activity timeline will be visible here once the sync job monitoring feature ships.
          </p>
        </article>

        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Failures</p>
              <h3 className="section-title">Retry and incident queue</h3>
            </div>
            <span className="toolbar-chip">Coming soon</span>
          </div>
          <p className="muted-text panel-copy">
            Failed and retrying sync jobs will appear here once the sync job monitoring feature ships.
          </p>
        </article>
      </div>
    </PageLayout>
  );
}
