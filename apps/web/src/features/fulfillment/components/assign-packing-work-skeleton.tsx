/**
 * The fulfilment board while its first page loads (#3096)
 *
 * The board used to say "Loading packing work…" as a bare paragraph, and then
 * the metric row, the lanes and the pager all arrived at once and pushed the
 * page down. This draws the shape that is coming — the three metric cards and
 * two lanes of rows, in the board's own classes — so nothing moves when the
 * data lands. The shimmer bars are `DataTableSkeleton`'s, so a reduced-motion
 * preference stills them here exactly as it does on every list.
 *
 * One `role="status"` region carries the words; the shapes are `aria-hidden`.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';

const SKELETON_LANES = [3, 2] as const;

export function AssignPackingWorkSkeleton(): ReactElement {
  return (
    <div className="assign-packing-work-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{ASSIGN_PACKING_WORK_COPY.loading.message}</span>
      <div className="kpi-grid" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="kpi-card kpi-card--compact">
            <span className="data-table-skeleton__bar data-table-skeleton__bar--subtitle" />
            <span className="data-table-skeleton__bar assign-packing-work-skeleton__value" />
          </div>
        ))}
      </div>
      <div className="assign-packing-work-board" aria-hidden="true">
        {SKELETON_LANES.map((rows, laneIndex) => (
          <div key={laneIndex} className="assign-packing-work-lane">
            <div className="assign-packing-work-lane__head">
              <span className="assign-packing-work-skeleton__avatar" />
              <span className="data-table-skeleton__bar assign-packing-work-skeleton__title" />
            </div>
            <ul className="assign-packing-work-card-list">
              {Array.from({ length: rows }, (_, rowIndex) => (
                <li key={rowIndex} className="assign-packing-work-card">
                  <span className="data-table-skeleton__bar assign-packing-work-skeleton__ref" />
                  <span className="data-table-skeleton__bar assign-packing-work-skeleton__text" />
                  <span className="data-table-skeleton__bar data-table-skeleton__bar--action" />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
