/**
 * Analytics Trust Header
 *
 * Per-connection data-coverage disclosure: freshness, "data from" coverage
 * window, and ingestion state. #2083 (real per-connection earliestOrderDate)
 * has since landed — see Decision 3 in
 * docs/plans/implementation-plan-analytics-page-shell.md for the coverage
 * row's history; this renders the real MIN(placedAt)-derived fact rather
 * than the connectionCreatedAt approximation that row shipped with.
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
import type {
  ConnectionIngestionStatus,
  ConnectionIngestionTrust,
} from '../api/analytics-trust.types';

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
        <div className="trust-header__title-group">
          <h3 className="section-title">Data coverage</h3>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="analytics-info-popover-trigger"
                aria-label="About these dates"
              >
                &#9432;
              </button>
            </PopoverTrigger>
            <PopoverContent>
              &ldquo;Last polled&rdquo; is when each channel&rsquo;s ingestion pipe last succeeded —
              it is not proof that new order data has arrived. &ldquo;Data from&rdquo; is the
              earliest order OpenLinker has ingested for this connection, so a recently-connected
              channel isn&rsquo;t misread as underperforming.
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
              <span className="trust-header__fact-label">Last polled</span>
              <span className="trust-header__fact-value">
                {entry.lastPollAt ? (
                  <TimeDisplay iso={entry.lastPollAt} format="datetime" />
                ) : (
                  'Never polled'
                )}
              </span>
            </span>
            <span>
              <span className="trust-header__fact-label">Data from</span>
              <span className="trust-header__fact-value">
                {entry.earliestOrderDate ? (
                  <TimeDisplay iso={entry.earliestOrderDate} format="date" />
                ) : (
                  'No orders yet'
                )}
              </span>
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
