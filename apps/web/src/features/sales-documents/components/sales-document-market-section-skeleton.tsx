/**
 * SalesDocumentMarketSectionSkeleton (#2543)
 *
 * Loading treatment for `SalesDocumentMarketSection` — sized from
 * `SalesDocumentMarketRow`'s own shape (status dot, identity block, outcome
 * headline + reason line, action button) so the section does not reflow when
 * the real rows arrive, mirroring `DataTableSkeleton`'s row-shape-declared
 * approach rather than a fixed row height.
 *
 * A blank load must never read as "nothing is configured" (#2543 acceptance):
 * the skeleton renders a fixed number of placeholder rows plus a visible,
 * `aria-live="polite"` narration line, so a screen-reader user and a sighted
 * user both get an explicit "loading" signal rather than silence.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import type { ReactElement } from 'react';

const SKELETON_ROW_COUNT = 3;

export function SalesDocumentMarketSectionSkeleton(): ReactElement {
  return (
    <div className="page-section sales-document-market-section" role="status" aria-live="polite">
      <span className="sr-only">Loading markets…</span>
      <span
        className="sales-document-market-section__summary-skeleton"
        aria-hidden="true"
      />
      <ul
        className="sales-document-market-row-list sales-document-market-row-list--skeleton"
        aria-hidden="true"
      >
        {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
          <li key={index} className="sales-document-market-row sales-document-market-row--skeleton">
            <div className="sales-document-market-row__status">
              <span className="skeleton-bar skeleton-bar--dot" />
            </div>
            <div className="sales-document-market-row__identity">
              <span className="skeleton-bar skeleton-bar--name" />
              <span className="skeleton-bar skeleton-bar--meta" />
            </div>
            <div className="sales-document-market-row__outcome">
              <span className="skeleton-bar skeleton-bar--outcome" />
              <span className="skeleton-bar skeleton-bar--reason" />
            </div>
            <div className="sales-document-market-row__action">
              <span className="skeleton-bar skeleton-bar--action" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
