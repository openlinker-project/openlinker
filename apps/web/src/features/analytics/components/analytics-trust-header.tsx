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
 * Row layout follows the mockup's single-line fact string ("data from … ·
 * synced …" + status badge, right-aligned, mono/tabular-nums) rather than
 * stacked label/value pairs. The mockup's "Backfilling" state and its
 * range-gated "Covers N of M days" coverage-ratio note are deliberately
 * NOT implemented here — see Decision 3a / Decision 4 in the plan: neither
 * `GET /analytics/trust` nor `ConnectionIngestionStatus` carries a
 * range-aware coverage fact today, and inventing one would render a number
 * this page cannot honestly support. Follow-up once #1990 exists.
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
  stalled: 'error',
  disconnected: 'error',
  'never-ingested': 'neutral',
  unknown: 'neutral',
};

const STATUS_LABEL: Record<ConnectionIngestionStatus, string> = {
  fresh: 'Up to date',
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
          <h3 className="section-title">Synchronization</h3>
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
              Dates are the earliest order stored for each channel, not a guarantee of
              completeness. Some later orders may also be missing.
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="trust-header">
        {connections.map((entry) => (
          <div className="trust-header__row" key={entry.connectionId}>
            <span className="trust-header__name">
              <span
                className="trust-header__dot"
                data-channel={entry.platformType}
                aria-hidden="true"
              />
              {entry.connectionName}
            </span>
            <span className="trust-header__facts">
              {entry.earliestOrderDate ? (
                <>
                  data from <TimeDisplay iso={entry.earliestOrderDate} format="date" />
                </>
              ) : (
                'no orders yet'
              )}
              {' · '}
              {entry.lastPollAt ? (
                <>
                  synced <TimeDisplay iso={entry.lastPollAt} format="time" />
                </>
              ) : (
                'never polled'
              )}
              <StatusBadge tone={STATUS_TONE[entry.status]} withDot>
                {STATUS_LABEL[entry.status]}
              </StatusBadge>
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
