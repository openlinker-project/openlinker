/**
 * The task detail while it loads (#3096)
 *
 * The page used to swap in a full-width `LoadingState` card, and then the
 * explainer, the hero and six cards arrived at once and pushed everything
 * down. This draws the cards that are coming, in the page's own layout
 * classes, so nothing jumps when the task lands. The bars are
 * `DataTableSkeleton`'s shimmer, so a reduced-motion preference stills them.
 *
 * One `role="status"` region carries the words; the shapes are `aria-hidden`.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { DetailSection } from '../../../shared/ui/detail-section';
import { FULFILLMENT_WORK_DETAIL_COPY } from '../lib/fulfillment-work-detail.copy';

function SkeletonCard({ lines, tone }: { lines: number; tone?: 'hero' }): ReactElement {
  return (
    <DetailSection tone={tone}>
      <span className="data-table-skeleton__bar data-table-skeleton__bar--title" />
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="data-table-skeleton__bar data-table-skeleton__bar--subtitle fulfilment-work-detail__skeleton-line"
        />
      ))}
    </DetailSection>
  );
}

export function FulfillmentWorkDetailSkeleton(): ReactElement {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{FULFILLMENT_WORK_DETAIL_COPY.states.loading.title}</span>
      <div
        className="order-detail__primary-grid order-detail__primary-grid--split fulfilment-work-detail__layout"
        aria-hidden="true"
      >
        <div className="order-detail__stack fulfilment-work-detail__main">
          <SkeletonCard tone="hero" lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </div>
        <div className="order-detail__stack fulfilment-work-detail__rail">
          <SkeletonCard lines={1} />
          <SkeletonCard lines={2} />
        </div>
      </div>
    </div>
  );
}
