/**
 * Connection health - row ordering and the summary counts (#4016).
 *
 * Pure helpers behind the Insights "Connection health" panel, kept apart from
 * the component so the ordering rule and the counts are testable on their own.
 *
 * Two facts are deliberately kept separate here. A connection's own `status`
 * says whether OpenLinker can talk to the platform; its dead-job count says
 * whether work for it stopped retrying. The panel used to fold the second into
 * the first (an amber "ACTIVE"), which read as "the connection is broken" when
 * only its jobs were.
 *
 * @module pages/insights
 */
import type { Connection, ConnectionStatus } from '../../features/connections';
import type { Messages, PluralFn, ResolvedCopy } from '../../shared/i18n';

export type ConnectionHealthCopy = ResolvedCopy<Messages['analytics']>['insightsPage']['connectionHealth'];

export interface ConnectionHealthRow {
  connection: Connection;
  deadJobCount: number;
}

/** The three buckets the health strip and its legend count. `off` covers a
 *  connection the operator switched off or archived. */
export type ConnectionHealthBucket = 'attention' | 'healthy' | 'off';

export interface ConnectionHealthSummary {
  total: number;
  /** Connections with at least one dead job. */
  withFailedJobs: number;
  attention: number;
  healthy: number;
  off: number;
}

const BROKEN_STATUSES: ReadonlySet<ConnectionStatus> = new Set(['error', 'needs_reauth']);

/**
 * A connection needs attention when its jobs stopped retrying or OpenLinker
 * can no longer reach the platform. A disabled connection is neither: the
 * operator switched it off, so it is counted on its own.
 */
export function bucketOf(row: ConnectionHealthRow): ConnectionHealthBucket {
  if (row.deadJobCount > 0 || BROKEN_STATUSES.has(row.connection.status)) return 'attention';
  if (row.connection.status === 'disabled' || row.connection.status === 'archived') return 'off';
  return 'healthy';
}

/** Most failed jobs first, then broken connections, then by name. */
export function sortConnectionHealthRows(
  rows: readonly ConnectionHealthRow[]
): ConnectionHealthRow[] {
  return [...rows].sort((a, b) => {
    if (b.deadJobCount !== a.deadJobCount) return b.deadJobCount - a.deadJobCount;
    const rank = (row: ConnectionHealthRow): number => {
      const bucket = bucketOf(row);
      return bucket === 'attention' ? 0 : bucket === 'healthy' ? 1 : 2;
    };
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.connection.name.localeCompare(b.connection.name);
  });
}

export function summarizeConnectionHealth(
  rows: readonly ConnectionHealthRow[]
): ConnectionHealthSummary {
  const summary: ConnectionHealthSummary = {
    total: rows.length,
    withFailedJobs: 0,
    attention: 0,
    healthy: 0,
    off: 0,
  };
  for (const row of rows) {
    if (row.deadJobCount > 0) summary.withFailedJobs += 1;
    summary[bucketOf(row)] += 1;
  }
  return summary;
}

/**
 * The one-sentence summary above the list. Takes the copy and the plural
 * function as arguments so it stays a pure helper the tests can call
 * without rendering.
 */
export function describeConnectionHealth(
  summary: ConnectionHealthSummary,
  copy: ConnectionHealthCopy,
  plural: PluralFn
): string {
  if (summary.withFailedJobs === 0) {
    return summary.attention === 0
      ? plural(summary.total, copy.summary.noFailedJobs)
      : plural(summary.total, copy.summary.cannotReach, { attention: summary.attention });
  }
  if (summary.total === 1) return copy.summary.onlyConnectionFailed;
  return plural(summary.withFailedJobs, copy.summary.withFailedJobs, { total: summary.total });
}

/** Which `status` copy key labels a connection status. */
export const CONNECTION_STATUS_LABEL_KEY: Record<
  ConnectionStatus,
  keyof ConnectionHealthCopy['status']
> = {
  active: 'active',
  disabled: 'disabled',
  error: 'error',
  needs_reauth: 'needsReauth',
  archived: 'archived',
};
