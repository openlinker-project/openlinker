/**
 * One box this bench has already closed today (#3416, mockup-parity epic
 * #3401)
 *
 * A LOG entry, not a queue item — the mockup's own copy: "this is a log, not
 * a queue, nothing to click through to". Rendered as a plain `<li>`, never a
 * `<button>`, so there is no affordance implying it can be opened.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement } from 'react';

import { formatAbsoluteTime } from '../../../shared/format/format-date';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BenchPackedTodayRow as BenchPackedTodayRowData } from '../api/bench-parcel.types';

export interface BenchPackedTodayRowProps {
  readonly row: BenchPackedTodayRowData;
}

export function BenchPackedTodayRow({ row }: BenchPackedTodayRowProps): ReactElement {
  return (
    <li className="bench-rail-row bench-rail-row--done" data-testid="bench-packed-today-row">
      <div className="bench-rail-row__identity">
        <span className="bench-rail-row__reference">{row.orderReference}</span>
        {row.buyerName === null ? null : (
          <span className="bench-rail-row__meta">{row.buyerName}</span>
        )}
      </div>
      <StatusBadge tone="success" withDot compact>
        {formatAbsoluteTime(row.closedAt)}
      </StatusBadge>
    </li>
  );
}
