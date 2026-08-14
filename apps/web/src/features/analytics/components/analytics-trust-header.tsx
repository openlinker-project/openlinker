/**
 * Analytics Trust Header
 *
 * Per-connection data-coverage disclosure: freshness, "connected since",
 * and ingestion state. Ships without a "data from" coverage-window row —
 * see Decision 3 in docs/plans/implementation-plan-analytics-page-shell.md
 * (the backend has no real earliest-order-date field yet; tracked as #2083).
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  StatusBadge,
  TimeDisplay,
  type StatusBadgeTone,
} from '../../../shared/ui';
import type { ConnectionIngestionStatus, ConnectionIngestionTrust } from '../api/analytics-trust.types';

interface AnalyticsTrustHeaderProps {
  connections: ConnectionIngestionTrust[];
}

const STATUS_TONE: Record<ConnectionIngestionStatus, StatusBadgeTone> = {
  fresh: 'success',
  stalled: 'warning',
  disconnected: 'error',
  'never-ingested': 'neutral',
  unknown: 'neutral',
};

const STATUS_LABEL: Record<ConnectionIngestionStatus, string> = {
  fresh: 'Fresh',
  stalled: 'Stalled',
  disconnected: 'Disconnected',
  'never-ingested': 'Never ingested',
  unknown: 'Unknown',
};

export function AnalyticsTrustHeader({ connections }: AnalyticsTrustHeaderProps): ReactElement {
  return (
    <article className="panel panel--dense">
      <div className="panel__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <h3 className="section-title">Data coverage</h3>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="info-popover-trigger" aria-label="About these dates">
                &#9432;
              </button>
            </PopoverTrigger>
            <PopoverContent>
              Freshness is when each channel&rsquo;s ingestion pipe last succeeded. &ldquo;Connected
              since&rdquo; is when the connection was configured in OpenLinker, not a claim about how
              far back its order history goes.
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="trust-header">
        {connections.map((entry) => (
          <div className="trust-header__row" key={entry.connectionId}>
            <span className="trust-header__name">
              <StatusBadge tone={STATUS_TONE[entry.status]} withDot>
                {STATUS_LABEL[entry.status]}
              </StatusBadge>
              {entry.connectionName}
            </span>
            <span>
              <span className="trust-header__fact-label">Current to</span>
              <span className="trust-header__fact-value">
                {entry.lastPollAt ? (
                  <TimeDisplay iso={entry.lastPollAt} format="datetime" />
                ) : (
                  'Never polled'
                )}
              </span>
            </span>
            <span>
              <span className="trust-header__fact-label">Connected since</span>
              <span className="trust-header__fact-value">
                <TimeDisplay iso={entry.connectionCreatedAt} format="date" />
              </span>
            </span>
            <span />
          </div>
        ))}
      </div>
    </article>
  );
}
