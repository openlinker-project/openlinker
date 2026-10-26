/**
 * Unlinked-Catalogue-Lines Badge
 *
 * One render of "this document went out with lines the accounting system could
 * not match to a product", shared verbatim by the desktop document cluster,
 * the mobile order card and the order-detail sales-document panel.
 *
 * A component rather than three inline renders for the reason
 * `TaxRateConflictBadge`'s own header records: the retired `OrderInvoicingCell`
 * hand-duplicated its render path and the copies drifted, and #2761 caught the
 * same shape reappearing with the screen-reader hint present on desktop and
 * missing on mobile.
 *
 * It is deliberately its OWN line beside the sales-document cell and never
 * folded into it. The document was issued - that is the whole point of the
 * warning - so anything that suppresses on "a document exists" would suppress
 * this badge on every order it is about.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactNode } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { ParsedOrderInvoice } from '../api/order-snapshot.schema';
import { unlinkedCatalogueLinesBadge } from '../lib/order-row';

export function UnlinkedCatalogueLinesBadge({
  invoice,
}: {
  invoice?: ParsedOrderInvoice | null;
}): ReactNode {
  const badge = unlinkedCatalogueLinesBadge(invoice);
  if (!badge) return null;
  return (
    <span title={badge.hint}>
      <StatusBadge tone="conflict" withDot compact>
        {badge.label}
      </StatusBadge>
      {/* Only the hint - `StatusBadge` already announces `label` as visible
          text, and a second sr-only copy would read it twice (#2761 review). */}
      <span className="sr-only">{badge.hint}</span>
    </span>
  );
}
