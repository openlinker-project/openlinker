/**
 * Bulk Result Rows (#3619, the bulk-dispatch per-row report precedent)
 *
 * One line per order the action was asked about: the order id (a link to its
 * detail), a status badge and the server's own reason where there is one. Shared
 * by the cancel, tag and buyer-message dialogs so a failed row never hides the
 * others and the three reports read the same.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';

export interface BulkResultRow {
  orderId: string;
  tone: StatusBadgeTone;
  label: string;
  /** The server's reason or code text for a refusal or failure. */
  detail?: string | null;
  /** Extra inline content, e.g. a link to the correction proposal. */
  extra?: ReactNode;
}

export function BulkResultRows({
  rows,
  testId,
}: {
  rows: readonly BulkResultRow[];
  testId: string;
}): ReactElement {
  return (
    <div className="bulk-dispatch__results" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.orderId} className="bulk-dispatch__result-row" data-testid="orders-bulk-result-row">
          <Link className="mono bulk-dispatch__ordid" to={`/orders/${encodeURIComponent(row.orderId)}`}>
            {row.orderId}
          </Link>
          <StatusBadge tone={row.tone} withDot compact>
            {row.label}
          </StatusBadge>
          {row.detail ? (
            <span className="bulk-dispatch__result-detail text-muted">{row.detail}</span>
          ) : null}
          {row.extra}
        </div>
      ))}
    </div>
  );
}
