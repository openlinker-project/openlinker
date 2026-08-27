/**
 * OMS Attention Badges
 *
 * The ONE row-badge renderer for spec §4.2's inert states, shared verbatim by a
 * desktop table cell and a mobile card — the `OrderInvoicingCell` / `OrderPhaseBadge`
 * shape (#2100/#2310). Two renderers would be two chances to describe one state
 * differently, which is the defect §4 exists to close.
 *
 * ## It renders NOTHING for an empty list
 *
 * A row with nothing stuck shows nothing at all — not a dash, not a neutral
 * "OK" pill. Nothing writes `omsAttention` yet (#2352 shipped the columns
 * undriven), so on every install today this is the only branch that runs, and it
 * must be silent rather than adding a column of placeholders to every order.
 *
 * ## The title is the full sentence, and it is also read out
 *
 * The badge label is the four-value short code (`Stopped` / `At risk` / …),
 * which is scannable and says nothing on its own. The sentence rides in `title`
 * for a pointer and in an `sr-only` span for a screen reader — the
 * `OrderPhaseBadge` attribution treatment, for the same reason: "who said this,
 * and about what" is the load-bearing half, not a hover nicety.
 *
 * @module apps/web/src/features/fulfillment-authority/components
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md § 4.3
 */
import type { ReactElement } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import {
  ATTENTION_BADGE_COPY,
  ATTENTION_UNKNOWN_COPY,
  type AttentionTitleParams,
} from '../lib/attention-reason.copy';
import { toAttentionEntryView, type AttentionEntryInput } from '../lib/attention-entry';

interface OmsAttentionBadgesProps {
  /**
   * The row's `omsAttention` array.
   *
   * Every field of `AttentionEntryInput` is optional and `unknown`-typed: this
   * is a jsonb projection whose element shape a newer writer may widen, so the
   * narrowing happens in `toAttentionEntryView` rather than at the prop
   * boundary. A caller passing a fully-typed array is unaffected.
   */
  entries: readonly AttentionEntryInput[];
  /** Placeholder values for the title template, when the caller has them. */
  titleParams?: AttentionTitleParams;
  /** Compact badge for a table row / card badge-row. */
  compact?: boolean;
}

export function OmsAttentionBadges({
  entries,
  titleParams,
  compact = false,
}: OmsAttentionBadgesProps): ReactElement | null {
  if (entries.length === 0) {
    return null;
  }

  // A ROW container, even though the caller's stack is a column: two producers
  // would otherwise stack into two lines and the orders Status cell's declared
  // four-line ceiling (style guide § Density & Row Heights) would be false.
  return (
    <span className="data-table__badge-row">
      {entries.map((entry, index) => {
        const view = toAttentionEntryView(entry, titleParams);
        // An unrecognised reason renders neutral under its own label: this build
        // cannot name the state, so it must not borrow one of the four short
        // codes, each of which is a positive claim about what went wrong.
        const label = view.known ? ATTENTION_BADGE_COPY[view.badge] : ATTENTION_UNKNOWN_COPY.badgeLabel;
        const tone = view.known ? view.tone : 'neutral';
        return (
          <span
            // Keyed on `(producer, reason)`. The reason ALONE is unique only by
            // today's accident that at most one counted item is derived per
            // question; the wire type promises nothing, so the first persisted
            // producer contributing a second entry with the same reason would
            // make React silently drop one — from the surface whose whole job
            // is surfacing it. The producer is the array's own key, and the
            // index is the last resort for an entry carrying neither.
            key={`${String(entry.producer ?? '')}:${String(entry.reason ?? '')}:${String(index)}`}
            className="who-decides-attention-badge"
            title={view.title}
          >
            <StatusBadge tone={tone} withDot compact={compact}>
              {label}
            </StatusBadge>
            <span className="sr-only">{` — ${view.title}`}</span>
          </span>
        );
      })}
    </span>
  );
}
