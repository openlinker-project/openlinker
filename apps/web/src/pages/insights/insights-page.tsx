/**
 * Insights Page — Operations overview
 *
 * Triage-first ops surface. KPI strip + "What's broken right now" pattern +
 * connection health roll-up. Failed-jobs KPI links to `/jobs-logs?status=dead`
 * and the grouped triage surface exposes Retry / View actions per group.
 *
 * @module pages/insights
 */
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { describeApiError } from '../../shared/api/describe-api-error';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { useDevStackHealthQuery } from '../../features/health/hooks/use-dev-stack-health-query';
import { useSyncJobsQuery } from '../../features/sync-jobs/hooks/use-sync-jobs-query';
import { useFailedJobGroupsQuery } from '../../features/sync-jobs/hooks/use-failed-job-groups-query';
import { useRetryGroupedSyncJobsMutation } from '../../features/sync-jobs/hooks/use-retry-grouped-sync-jobs-mutation';
import { usePlatforms, type Platform } from '../../shared/plugins';
import { useCostCoverageQuery } from '../../features/products/hooks/use-cost-coverage-query';
import { useTrackMargin } from '../../features/analytics';
import {
  getMessages,
  interpolate,
  useFormat,
  useMessages,
  usePlural,
} from '../../shared/i18n';
import { resolvePlatformLabel } from '../../features/mappings';
import type {
  DevStackHealth,
  ServiceStatus,
  OverallStatus,
} from '../../features/health/api/health.types';
import type {
  Connection,
  ConnectionStatus,
} from '../../features/connections/api/connections.types';
import type {
  JobStatus,
  SyncJob,
  SyncJobGroup,
} from '../../features/sync-jobs/api/sync-jobs.types';
import { INSIGHTS_HEALTH_INTERVAL_MS, INSIGHTS_JOBS_INTERVAL_MS } from './intervals';
import { ConnectionHealthList } from './connection-health-list';
import { SystemHealthList } from './system-health-list';
import { Button } from '../../shared/ui/button';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { KpiCard } from '../../shared/ui/kpi-card';
import { PageLayout } from '../../shared/ui/page-layout';
import { StatusBadge } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useToast } from '../../shared/ui/toast-provider';

type InsightsTone = 'success' | 'warning' | 'error' | 'neutral';

/** Stable row key for the grouped dead-job table; also used to track per-row pending state. */
function groupKey(group: Pick<SyncJobGroup, 'connectionId' | 'jobType'>): string {
  return `${group.connectionId}::${group.jobType}`;
}

function toRowStatusTone(status: ConnectionStatus | JobStatus): InsightsTone {
  if (status === 'active' || status === 'succeeded') return 'success';
  if (status === 'error' || status === 'dead') return 'error';
  if (status === 'needs_reauth') return 'warning';
  return 'neutral';
}

function mapHealthTone(
  status: ServiceStatus | OverallStatus | undefined,
  hasError: boolean
): InsightsTone {
  if (hasError || status === 'error') return 'error';
  if (status === 'warning' || status === 'degraded') return 'warning';
  if (status === 'ok') return 'success';
  return 'neutral';
}

function toHealthLabel(status: OverallStatus | undefined): string {
  const health = getMessages('analytics').insightsPage.health;
  if (status === 'ok') return health.ok;
  if (status === 'degraded') return health.degraded;
  if (status === 'error') return health.error;
  return health.unknown;
}

/** Operator label for a raw health, connection or job status; an unknown value is shown as sent. */
function statusLabel(status: string): string {
  const labels = getMessages('analytics').insightsPage.status;
  switch (status) {
    case 'ok':
      return labels.ok;
    case 'warning':
      return labels.warning;
    case 'error':
      return labels.error;
    case 'degraded':
      return labels.degraded;
    case 'active':
      return labels.active;
    case 'disabled':
      return labels.disabled;
    case 'needs_reauth':
      return labels.needsReauth;
    case 'archived':
      return labels.archived;
    case 'queued':
      return labels.queued;
    case 'running':
      return labels.running;
    case 'succeeded':
      return labels.succeeded;
    case 'dead':
      return labels.dead;
    default:
      return status;
  }
}

function formatJobType(jobType: string): string {
  return jobType.replaceAll('.', ' › ');
}

function renderHealthValue(
  status: OverallStatus | undefined,
  isLoading: boolean,
  hasError: boolean
): string {
  if (isLoading) return '—';
  if (hasError) return getMessages('analytics').insightsPage.health.unreachable;
  return toHealthLabel(status);
}

/**
 * Builds the ordered list of infrastructure node labels backing both the
 * Infrastructure panel and the KPI-strip summary (#1619). Core services are
 * always listed first, followed by one entry per infra-bearing connection
 * (e.g. a connected WooCommerce shop) — so the summary always reflects the
 * real node set instead of a fixed string.
 */
function buildInfraNodeLabels(
  data: DevStackHealth | undefined,
  platforms: readonly Platform[]
): string[] {
  if (!data) return [];
  const labels = ['Postgres', 'Redis', 'PrestaShop'];
  if (data.services.worker) {
    labels.push('Worker');
  }
  for (const connection of data.connections ?? []) {
    const platformLabel = resolvePlatformLabel(platforms, connection.platformType);
    labels.push(
      connection.name
        ? interpolate(getMessages('analytics').insightsPage.infraNodeWithName, {
            platform: platformLabel,
            name: connection.name,
          })
        : platformLabel
    );
  }
  return labels;
}

interface ConnectionFailureSignal {
  connectionId: string;
  deadJobCount: number;
}

interface RolledUpConnection {
  connection: Connection;
  deadJobCount: number;
  rollupTone: InsightsTone;
}

/**
 * Tally dead-job counts per connection from the server-returned groups.
 * Every dead job belongs to exactly one (connectionId, jobType) group, so the
 * per-connection total is `sum(group.count) where group.connectionId = C`.
 */
function summarizeFailuresByConnection(
  groups: SyncJobGroup[]
): Map<string, ConnectionFailureSignal> {
  const byConnection = new Map<string, ConnectionFailureSignal>();
  for (const group of groups) {
    const existing = byConnection.get(group.connectionId);
    if (existing) {
      existing.deadJobCount += group.count;
    } else {
      byConnection.set(group.connectionId, {
        connectionId: group.connectionId,
        deadJobCount: group.count,
      });
    }
  }
  return byConnection;
}

function rollUpConnectionHealth(
  connections: Connection[],
  failureSignals: Map<string, ConnectionFailureSignal>
): RolledUpConnection[] {
  return connections.map((connection) => {
    const deadJobCount = failureSignals.get(connection.id)?.deadJobCount ?? 0;
    let rollupTone: InsightsTone = toRowStatusTone(connection.status);
    // Job-signal roll-up: even if the DB row still says `active`, a connection
    // that is spilling dead jobs is not healthy. This replaces the
    // reassuring "All channels active" message with something actionable.
    if (connection.status !== 'error' && deadJobCount > 0) {
      rollupTone = 'warning';
    }
    return { connection, deadJobCount, rollupTone };
  });
}

export function InsightsPage(): ReactElement {
  const copy = useMessages('analytics').insightsPage;
  const format = useFormat();
  const plural = usePlural();
  const connectionsQuery = useConnectionsQuery(undefined, {
    refetchInterval: INSIGHTS_HEALTH_INTERVAL_MS,
  });
  const healthQuery = useDevStackHealthQuery({ refetchInterval: INSIGHTS_HEALTH_INTERVAL_MS });
  const recentJobsQuery = useSyncJobsQuery(
    undefined,
    { limit: 5 },
    { refetchInterval: INSIGHTS_JOBS_INTERVAL_MS }
  );
  const queuedJobsQuery = useSyncJobsQuery(
    { status: 'queued' },
    { limit: 1 },
    { refetchInterval: INSIGHTS_JOBS_INTERVAL_MS }
  );
  const deadGroupsQuery = useFailedJobGroupsQuery(
    { status: 'dead' },
    { refetchInterval: INSIGHTS_JOBS_INTERVAL_MS }
  );
  const retryGrouped = useRetryGroupedSyncJobsMutation();
  const { showToast } = useToast();
  // Per-group pending state. Retry disables only its own row button so an
  // operator can fire retries against different groups in parallel without
  // the whole table freezing on a shared mutation flag.
  const [pendingGroupKey, setPendingGroupKey] = useState<string | null>(null);

  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const connectionById = useMemo(
    () => new Map(connections.map((c) => [c.id, c] as const)),
    [connections]
  );
  const failedGroups = useMemo<SyncJobGroup[]>(
    () => deadGroupsQuery.data?.groups ?? [],
    [deadGroupsQuery.data]
  );
  const failureSignals = useMemo(() => summarizeFailuresByConnection(failedGroups), [failedGroups]);
  const rolledUpConnections = useMemo(
    () => rollUpConnectionHealth(connections, failureSignals),
    [connections, failureSignals]
  );

  const platforms = usePlatforms();
  const infraNodeLabels = useMemo(
    () => buildInfraNodeLabels(healthQuery.data, platforms),
    [healthQuery.data, platforms]
  );
  const systemHealthDescription = healthQuery.isLoading
    ? copy.checkingDependencies
    : infraNodeLabels.length > 0
      ? infraNodeLabels.join(' · ')
      : copy.noInfraNodes;

  const activeCount = connections.filter((c) => c.status === 'active').length;
  const errorCount = connections.filter((c) => c.status === 'error').length;
  const warningCount = rolledUpConnections.filter((r) => r.rollupTone === 'warning').length;
  const deadTotal = deadGroupsQuery.data?.totalJobs ?? 0;
  const totalGroups = deadGroupsQuery.data?.totalGroups ?? 0;
  const queuedTotal = queuedJobsQuery.data?.total ?? 0;

  const integrationTone: InsightsTone =
    errorCount > 0 ? 'warning' : warningCount > 0 ? 'warning' : 'neutral';
  const integrationDescription =
    errorCount > 0
      ? plural(errorCount, copy.connectionsInError)
      : warningCount > 0
        ? plural(warningCount, copy.connectionsFailing)
        : copy.allChannelsActive;

  const isFetching =
    connectionsQuery.isFetching ||
    healthQuery.isFetching ||
    recentJobsQuery.isFetching ||
    queuedJobsQuery.isFetching ||
    deadGroupsQuery.isFetching;

  function handleRefresh(): void {
    void connectionsQuery.refetch();
    void healthQuery.refetch();
    void recentJobsQuery.refetch();
    void queuedJobsQuery.refetch();
    void deadGroupsQuery.refetch();
  }

  const connectionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of connections) m.set(c.id, c.name);
    return m;
  }, [connections]);

  const handleRetryGroup = useCallback(
    async (group: SyncJobGroup): Promise<void> => {
      const key = groupKey(group);
      setPendingGroupKey(key);
      try {
        const result = await retryGrouped.mutateAsync({
          connectionId: group.connectionId,
          jobType: group.jobType,
        });
        if (result.count === 0) {
          // Race case: every candidate flipped out of `dead` between our
          // group-list fetch and the bulk retry — another operator beat us to
          // it, or a worker started processing. Not an error, but not a
          // green-checkmark success either.
          showToast({
            tone: 'info',
            title: copy.toast.nothingRequeued,
            description: interpolate(copy.toast.noDeadJobs, {
              jobType: formatJobType(group.jobType),
              skipped: format.number(result.skipped),
            }),
          });
        } else {
          const description =
            result.skipped > 0
              ? interpolate(copy.toast.requeuedSkipped, {
                  jobType: formatJobType(group.jobType),
                  count: format.number(result.count),
                  skipped: format.number(result.skipped),
                })
              : interpolate(copy.toast.willRerun, { jobType: formatJobType(group.jobType) });
          showToast({
            tone: 'success',
            title: plural(result.count, copy.toast.requeued),
            description,
          });
        }
      } catch (error) {
        showToast({
          tone: 'error',
          title: copy.toast.retryFailed,
          description: describeApiError(error, 'analytics'),
        });
      } finally {
        setPendingGroupKey((current) => (current === key ? null : current));
      }
    },
    [copy, format, plural, retryGrouped, showToast]
  );

  const failedGroupColumns: DataTableColumn<SyncJobGroup>[] = useMemo(
    () => [
      {
        id: 'jobType',
        header: copy.columns.jobType,
        cell: (group) => <span className="mono-text">{formatJobType(group.jobType)}</span>,
      },
      {
        id: 'connection',
        header: copy.columns.connection,
        cell: (group) => (
          <span>{connectionNameById.get(group.connectionId) ?? group.connectionId}</span>
        ),
        hideBelow: 768,
      },
      {
        id: 'count',
        header: copy.columns.failures,
        align: 'right',
        cell: (group) => (
          <StatusBadge tone="error" compact>
            {group.count}
          </StatusBadge>
        ),
      },
      {
        id: 'lastError',
        header: copy.columns.lastError,
        cell: (group) => (
          <span className="muted-text" title={group.lastError ?? undefined}>
            {group.lastError
              ? group.lastError.length > 80
                ? interpolate(copy.truncated, { text: group.lastError.slice(0, 80) })
                : group.lastError
              : '—'}
          </span>
        ),
        hideBelow: 1024,
      },
      {
        id: 'updatedAt',
        header: copy.columns.latest,
        align: 'right',
        cell: (group) => (
          <TimeDisplay iso={group.latestUpdatedAt} format="relative" className="muted-text" />
        ),
        hideBelow: 768,
      },
      {
        id: 'actions',
        header: copy.columns.actions,
        align: 'right',
        cell: (group): ReactElement => {
          const key = groupKey(group);
          const connectionName = connectionNameById.get(group.connectionId) ?? group.connectionId;
          const signature = interpolate(copy.signature, {
            jobType: formatJobType(group.jobType),
            connection: connectionName,
          });
          return (
            <div className="insights-incidents__actions">
              <Button
                tone="secondary"
                onClick={() => void handleRetryGroup(group)}
                disabled={pendingGroupKey === key}
                aria-label={interpolate(copy.retryAria, { signature })}
              >
                {pendingGroupKey === key ? copy.retrying : copy.retry}
              </Button>
              <Link
                className="button button--ghost"
                to={`/jobs-logs?status=dead&connectionId=${encodeURIComponent(group.connectionId)}&jobType=${encodeURIComponent(group.jobType)}`}
                aria-label={interpolate(copy.viewJobsAria, { signature })}
              >
                {copy.viewJobs}
              </Link>
            </div>
          );
        },
      },
    ],
    [connectionNameById, copy, handleRetryGroup, pendingGroupKey]
  );

  const recentJobColumns: DataTableColumn<SyncJob>[] = useMemo(
    () => [
      {
        id: 'jobType',
        header: copy.columns.jobType,
        cell: (job) => <span className="mono-text">{formatJobType(job.jobType)}</span>,
      },
      {
        id: 'status',
        header: copy.columns.status,
        cell: (job) => (
          <StatusBadge tone={toRowStatusTone(job.status)} compact>
            {statusLabel(job.status)}
          </StatusBadge>
        ),
      },
      {
        id: 'attempts',
        header: copy.columns.attempts,
        align: 'right',
        cell: (job) =>
          interpolate(copy.attempts, {
            attempts: format.number(job.attempts),
            max: format.number(job.maxAttempts),
          }),
        hideBelow: 768,
      },
      {
        id: 'updatedAt',
        header: copy.columns.updated,
        align: 'right',
        cell: (job) => <TimeDisplay iso={job.updatedAt} format="relative" className="muted-text" />,
      },
    ],
    [copy, format]
  );

  // #3588 - data to fill in. Not an incident: nothing is blocked, margin is just
  // missing a number. Rendered only when there is something to fill in.
  const trackMargin = useTrackMargin();
  const costCoverageQuery = useCostCoverageQuery({ enabled: trackMargin });
  const costGap = trackMargin ? costCoverageQuery.data : undefined;
  const hasCostGap = costGap !== undefined && costGap.soldVariantsWithoutCost > 0;

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      actions={
        <Button onClick={handleRefresh} disabled={isFetching}>
          {isFetching ? copy.refreshing : copy.refresh}
        </Button>
      }
    >
      {/* ── KPI strip ────────────────────────────────────────────── */}
      <section className="status-strip">
        <KpiCard
          label={copy.kpis.integrationHealth}
          value={
            connectionsQuery.isLoading
              ? '—'
              : interpolate(copy.kpis.activeOfTotal, {
                  active: format.number(activeCount),
                  total: format.number(connections.length),
                })
          }
          tone={integrationTone}
          description={integrationDescription}
        />

        <KpiCard
          label={copy.kpis.systemHealth}
          value={renderHealthValue(
            healthQuery.data?.status,
            healthQuery.isLoading,
            Boolean(healthQuery.error)
          )}
          tone={mapHealthTone(healthQuery.data?.status, Boolean(healthQuery.error))}
          description={systemHealthDescription}
        />

        {deadTotal > 0 ? (
          <KpiCard
            label={copy.kpis.failedJobs}
            value={deadTotal}
            tone="error"
            to="/jobs-logs?status=dead"
            description={plural(deadTotal, copy.kpis.needAttention)}
          />
        ) : (
          <KpiCard
            label={copy.kpis.failedJobs}
            value={deadGroupsQuery.isLoading ? '—' : 0}
            tone="neutral"
            description={copy.kpis.noFailures}
          />
        )}

        {queuedTotal > 0 ? (
          <KpiCard
            label={copy.kpis.queuedJobs}
            value={queuedTotal}
            tone="neutral"
            to="/jobs-logs?status=queued"
            description={plural(queuedTotal, copy.kpis.waiting)}
          />
        ) : (
          <KpiCard
            label={copy.kpis.queuedJobs}
            value={queuedJobsQuery.isLoading ? '—' : 0}
            tone="neutral"
            description={copy.kpis.queueEmpty}
          />
        )}
      </section>

      {hasCostGap ? (
        <article className="panel panel--dense" data-testid="insights-setup-gaps">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{copy.setup.eyebrow}</p>
              <h3 className="section-title">{copy.setup.title}</h3>
            </div>
            <span className="panel__meta">{copy.setup.meta}</span>
          </div>
          <ul className="insights-gaps">
            <li data-testid="insights-gap-cost-price">
              <StatusBadge tone="warning" withDot compact>
                {copy.setup.margin}
              </StatusBadge>
              <div className="insights-gaps__body">
                <b>
                  {plural(costGap.soldVariantsWithoutCost, copy.setup.variantsWithoutCost, {
                    days: format.number(costGap.days),
                  })}
                </b>
                <span className="text-muted">
                  {interpolate(copy.setup.leftOut, {
                    amount: format.money(costGap.netSalesWithoutCost, costGap.currency),
                  })}
                  {costGap.top3SharePct !== null && costGap.soldVariantsWithoutCost > 3
                    ? ` ${interpolate(copy.setup.topThree, {
                        pct: format.percent(Math.round(costGap.top3SharePct) / 100, {
                          maximumFractionDigits: 0,
                        }),
                      })}`
                    : ''}
                </span>
              </div>
              <Link
                className="button button--secondary button--sm"
                to="/products/cost-prices"
                data-testid="insights-gap-cost-price-open"
              >
                {copy.setup.addCostPrices}
              </Link>
            </li>
          </ul>
        </article>
      ) : null}

      {/* ── What's broken right now (primary triage surface) ──────── */}
      <article className="panel panel--dense insights-incidents">
        <div className="panel__header">
          <div>
            <p className="eyebrow">{copy.incidents.eyebrow}</p>
            <h3 className="section-title">{copy.incidents.title}</h3>
          </div>
          {deadTotal > 0 ? (
            <span className="panel__meta">
              {plural(totalGroups, copy.incidents.signatures)}
              {' · '}
              {plural(deadTotal, copy.incidents.totalFailures)}
            </span>
          ) : null}
        </div>

        {deadGroupsQuery.isLoading ? (
          <LoadingState
            title={copy.incidents.loadingTitle}
            message={copy.incidents.loadingMessage}
            liveRegion="off"
          />
        ) : deadGroupsQuery.error ? (
          <ErrorState
            title={copy.incidents.errorTitle}
            message={describeApiError(deadGroupsQuery.error, 'analytics')}
            action={<Button onClick={() => void deadGroupsQuery.refetch()}>{copy.retry}</Button>}
          />
        ) : (
          <DataTable
            caption={copy.incidents.caption}
            columns={failedGroupColumns}
            rows={failedGroups}
            rowKey={(group) => groupKey(group)}
            cardView={{
              title: (group) => <span className="mono-text">{formatJobType(group.jobType)}</span>,
              subtitle: (group) => (
                <span>
                  {plural(group.count, copy.incidents.cardSubtitle, {
                    connection: connectionNameById.get(group.connectionId) ?? group.connectionId,
                  })}
                </span>
              ),
              meta: (group) => (
                <StatusBadge tone="error" compact>
                  {group.count}
                </StatusBadge>
              ),
            }}
            emptyState={<p className="muted-text">{copy.incidents.empty}</p>}
          />
        )}
      </article>

      {/* ── Connection + system health ───────────────────────────── */}
      <div className="workspace-grid workspace-grid--primary">
        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{copy.connections.eyebrow}</p>
              <h3 className="section-title">{copy.connections.title}</h3>
            </div>
            <span className="panel__meta">
              {connectionsQuery.isLoading
                ? '…'
                : interpolate(copy.connections.configured, {
                    n: format.number(connections.length),
                  })}
            </span>
          </div>

          {connectionsQuery.isLoading && (
            <LoadingState
              title={copy.connections.loadingTitle}
              message={copy.connections.loadingMessage}
              liveRegion="off"
            />
          )}
          {connectionsQuery.error && (
            <ErrorState
              title={copy.connections.errorTitle}
              message={describeApiError(connectionsQuery.error, 'analytics')}
              action={<Button onClick={() => void connectionsQuery.refetch()}>{copy.retry}</Button>}
            />
          )}
          {!connectionsQuery.isLoading && !connectionsQuery.error && (
            <ConnectionHealthList rows={rolledUpConnections} />
          )}
        </article>

        <article className="panel panel--dense">
          <div className="panel__header">
            <div>
              <p className="eyebrow">{copy.infrastructure.eyebrow}</p>
              <h3 className="section-title">{copy.infrastructure.title}</h3>
            </div>
            {healthQuery.data && (
              <span className="sys-health__head">
                <StatusBadge tone={mapHealthTone(healthQuery.data.status, false)} withDot>
                  {toHealthLabel(healthQuery.data.status)}
                </StatusBadge>
                <span className="sys-health__checked">
                  {copy.infrastructure.checked}{' '}
                  <TimeDisplay iso={healthQuery.data.timestamp} format="relative" />
                </span>
              </span>
            )}
          </div>

          {healthQuery.isLoading && (
            <LoadingState
              title={copy.infrastructure.loadingTitle}
              message={copy.infrastructure.loadingMessage}
              liveRegion="off"
            />
          )}
          {healthQuery.error && (
            <ErrorState
              title={copy.infrastructure.errorTitle}
              message={describeApiError(healthQuery.error, 'analytics')}
              action={<Button onClick={() => void healthQuery.refetch()}>{copy.retry}</Button>}
            />
          )}
          {healthQuery.data && (
            <SystemHealthList data={healthQuery.data} connectionById={connectionById} />
          )}
        </article>
      </div>

      {/* ── Recent activity (secondary) ──────────────────────────── */}
      <article className="panel panel--dense">
        <div className="panel__header">
          <div>
            <p className="eyebrow">{copy.activity.eyebrow}</p>
            <h3 className="section-title">{copy.activity.title}</h3>
          </div>
          <span className="panel__meta">
            {recentJobsQuery.isLoading
              ? '…'
              : interpolate(copy.activity.total, {
                  n: format.number(recentJobsQuery.data?.total ?? 0),
                })}
          </span>
        </div>

        {recentJobsQuery.isLoading && (
          <LoadingState
            title={copy.activity.loadingTitle}
            message={copy.activity.loadingMessage}
            liveRegion="off"
          />
        )}
        {recentJobsQuery.error && (
          <ErrorState
            title={copy.activity.errorTitle}
            message={describeApiError(recentJobsQuery.error, 'analytics')}
            action={<Button onClick={() => void recentJobsQuery.refetch()}>{copy.retry}</Button>}
          />
        )}
        {!recentJobsQuery.isLoading && !recentJobsQuery.error && (
          <DataTable
            caption={copy.activity.caption}
            columns={recentJobColumns}
            rows={recentJobsQuery.data?.items ?? []}
            rowKey={(row) => row.id}
            emptyState={<p className="muted-text">{copy.activity.empty}</p>}
          />
        )}
      </article>
    </PageLayout>
  );
}
