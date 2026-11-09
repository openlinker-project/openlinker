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
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { selectDegradedConnections } from '../lib/ingestion-trust.lib';
import type { ConnectionIngestionTrust } from '../api/analytics-trust.types';

interface AnalyticsDegradationBannerProps {
  connections: ConnectionIngestionTrust[];
}

export function AnalyticsDegradationBanner({
  connections,
}: AnalyticsDegradationBannerProps): ReactElement | null {
  const copy = useMessages('analytics').analyticsDegradationBanner;
  const format = useFormat();
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
              ? interpolate(copy.notPolledSince, {
                  connection: entry.connectionName,
                  date: format.dateTime(entry.lastPollAt),
                })
              : interpolate(copy.neverPolled, { connection: entry.connectionName })
          }
          action={
            <Link
              className="button button--secondary button--sm"
              to={`/cursors?connectionId=${entry.connectionId}`}
            >
              {copy.viewSync}
            </Link>
          }
        >
          {copy.body}
        </Alert>
      ))}
    </>
  );
}
