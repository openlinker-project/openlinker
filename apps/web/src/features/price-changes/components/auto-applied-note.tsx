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
 * `#auto-applied-note` — appears only when at least one destination
 * connection (or one of its per-source overrides) is set to Automatic
 * **and** the recent-log has at least one entry to show for it
 * (`anyConnectionAutomatic`, mirroring the mockup's own function of the same
 * name). Gating on config rather than only on log presence is what lets the
 * note disappear again once every connection is switched back to Manual —
 * `price_change_auto_applied_log` has no retention sweep, so a log-only
 * gate would stay visible forever after the first auto-apply.
 *
 * **Deviates from the mockup's exact text** ("...today") because
 * `GET /listings/price-changes/auto-applied` (#3145) is a plain "most
 * recent N" log read with no calendar-day boundary — asserting "today"
 * would be a claim the data doesn't back for an item from, say, three days
 * ago that still fits in the last-N window.
 *
 * @module apps/web/src/features/price-changes/components
 */
import { useState, type ReactElement } from 'react';
import { useAutoAppliedPriceChangesQuery } from '../hooks/use-auto-applied-price-changes-query';
import { useDestinationPricingSyncSummaries } from '../hooks/use-destination-pricing-sync-summaries';
import { anyConnectionAutomatic } from '../lib/pricing-sync-mode';
import { formatAutoAppliedCount } from '../lib/auto-applied-count-label';
import type { Connection } from '../../connections';
import { AutoAppliedDialog, type AutoAppliedRow } from './auto-applied-dialog';

export interface AutoAppliedNoteProps {
  /**
   * Same set `PricingRulesPickerDialog` reads. That dialog's own read is
   * gated on `open` (#3167 review), so it no longer fires unconditionally.
   * This note's own `useDestinationPricingSyncSummaries` call is in turn
   * gated on the (cheap, single-request) auto-applied log read having any
   * entries at all (#3168 review): the config fan-out is one request PER
   * destination connection, so firing it on every mount regardless of
   * whether the log has anything to show would spend N requests deciding
   * whether to render a banner that, on an empty log, is `null` no matter
   * what the config says. With the log empty this note now costs exactly
   * one request; with entries present, it costs 1 + N, same as before, and
   * shares its query key with the picker so the two never double-fetch.
   */
  destinationConnections: readonly Connection[];
}

export function AutoAppliedNote({ destinationConnections }: AutoAppliedNoteProps): ReactElement | null {
  const [dialogOpen, setDialogOpen] = useState(false);
  const query = useAutoAppliedPriceChangesQuery();
  const items = query.data ?? [];

  const connectionIds = destinationConnections.map((c) => c.id);
  const summaries = useDestinationPricingSyncSummaries(connectionIds, { enabled: items.length > 0 });

  const show = items.length > 0 && anyConnectionAutomatic(summaries.map((s) => s.data));

  if (!show) return null;

  const connectionLabelById = new Map(destinationConnections.map((c) => [c.id, c.name]));

  const rows: AutoAppliedRow[] = items.map((item) => ({
    item,
    productName: item.productName,
    variantLabel: item.variantLabel,
    destinationLabel: connectionLabelById.get(item.destinationConnectionId) ?? item.destinationConnectionId,
  }));

  const count = formatAutoAppliedCount(items.length);

  return (
    <>
      <div className="filter-note" id="auto-applied-note" role="status">
        <span id="auto-applied-count">{count.label}</span> price change{count.plural ? 's' : ''} went live
        automatically recently (
        <button
          type="button"
          className="filter-note__action"
          id="auto-applied-link"
          onClick={() => setDialogOpen(true)}
        >
          see them
        </button>
        )
      </div>
      <AutoAppliedDialog open={dialogOpen} onOpenChange={setDialogOpen} rows={rows} />
    </>
  );
}
