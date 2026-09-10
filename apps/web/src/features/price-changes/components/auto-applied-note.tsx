/**
 * AutoAppliedNote (#3151, ADR-072 decision 3)
 *
 * The deliberately-minimal stand-in for a full "Daily digest" mode, cut
 * during design because no notification/summary surface exists anywhere in
 * the codebase — this component is the ENTIRE scope of that decision. Do
 * not expand it into a dedicated page: that is explicitly out of scope and
 * has no tracked follow-up (it's a comment in the mockup, and stays one
 * here).
 *
 * Mirrors `docs/plans/mockups/price-changes-review-queue.html`'s
 * `#auto-applied-note` — appears only when there is at least one
 * automatically-applied change to show. **Deviates from the mockup's exact
 * text** ("...today") because `GET /listings/price-changes/auto-applied`
 * (#3145) is a plain "most recent N" log read with no calendar-day
 * boundary — asserting "today" would be a claim the data doesn't back for
 * an item from, say, three days ago that still fits in the last-N window.
 *
 * @module apps/web/src/features/price-changes/components
 */
import { useState, type ReactElement } from 'react';
import { useAutoAppliedPriceChangesQuery } from '../hooks/use-auto-applied-price-changes-query';
import { useAutoAppliedVariantSummaries } from '../hooks/use-auto-applied-variant-summaries';
import { useConnectionsQuery } from '../../connections';
import { AutoAppliedDialog, type AutoAppliedRow } from './auto-applied-dialog';

export function AutoAppliedNote(): ReactElement | null {
  const [dialogOpen, setDialogOpen] = useState(false);
  const query = useAutoAppliedPriceChangesQuery();
  const connectionsQuery = useConnectionsQuery();

  const items = query.data ?? [];
  const variantIds = items.map((i) => i.productVariantId);
  const variantSummaries = useAutoAppliedVariantSummaries(variantIds);

  if (items.length === 0) return null;

  const connectionLabelById = new Map((connectionsQuery.data ?? []).map((c) => [c.id, c.name]));

  const rows: AutoAppliedRow[] = items.map((item, index) => {
    const variant = variantSummaries[index]?.data;
    const label = variant?.name ?? variant?.sku ?? item.productVariantId;
    return {
      item,
      label,
      destinationLabel: connectionLabelById.get(item.destinationConnectionId) ?? item.destinationConnectionId,
    };
  });

  return (
    <>
      <div className="filter-note" id="auto-applied-note">
        <span id="auto-applied-count">{items.length}</span> price change{items.length === 1 ? '' : 's'} went live
        automatically recently (
        <a
          id="auto-applied-link"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setDialogOpen(true);
          }}
        >
          see them
        </a>
        )
      </div>
      <AutoAppliedDialog open={dialogOpen} onOpenChange={setDialogOpen} rows={rows} />
    </>
  );
}
