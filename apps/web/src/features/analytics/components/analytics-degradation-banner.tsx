/**
 * Analytics Degradation Banner
 *
 * Page-level warning for a connection whose ingestion appears stalled or
 * disconnected. Ships status-only for v1 — see Decision 4 in
 * docs/plans/implementation-plan-analytics-page-shell.md.
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../../../shared/ui';
import { formatDateTime } from '../../../shared/format/format-date';
import { selectDegradedConnections } from '../lib/ingestion-trust.lib';
import type { ConnectionIngestionTrust } from '../api/analytics-trust.types';

interface AnalyticsDegradationBannerProps {
  connections: ConnectionIngestionTrust[];
}

export function AnalyticsDegradationBanner({
  connections,
}: AnalyticsDegradationBannerProps): ReactElement | null {
  const degraded = selectDegradedConnections(connections);

  if (degraded.length === 0) {
    return null;
  }

  return (
    <>
      {degraded.map((entry) => (
        <Alert
          key={entry.connectionId}
          tone="error"
          title={
            entry.lastPollAt
              ? `${entry.connectionName} has not been polled since ${formatDateTime(entry.lastPollAt)}`
              : `${entry.connectionName} has never been polled`
          }
          action={
            <Link
              className="button button--secondary button--sm"
              to={`/cursors?connectionId=${entry.connectionId}`}
            >
              View sync
            </Link>
          }
        >
          This is an ingestion gap, not a drop in sales.
        </Alert>
      ))}
    </>
  );
}
