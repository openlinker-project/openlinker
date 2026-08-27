/**
 * Return Line State Chips
 *
 * The two orthogonal per-line axes: where the goods are, and where the refund
 * is (ADR-060 — they are never collapsed, because a marketplace routinely
 * refunds before the parcel arrives).
 *
 * **Wave 2 drives both** (#2378). `tracked` now defaults to `true` — the prop was
 * added in Wave 1c precisely so this would be a one-line flip rather than a
 * rewrite — and the chips carry their rail LABEL, so the two axes read as two
 * labelled rails rather than two anonymous badges.
 *
 * Deliberately extended rather than joined by a parallel "rails" component: two
 * renderings of one fact is the defect this wave keeps closing, and these chips
 * already ARE the two rails.
 *
 * Two money states earn more than a neutral badge, and only two:
 *
 * - **`in_doubt`** is a first-class WARNING, not an error and not a worse
 *   `pending`. OpenLinker crossed a provider boundary and does not know the
 *   outcome, so the copy says *do not refund again* — a retry there moves real
 *   money twice.
 * - **`refunded`** is attributed, because it is only ever entered from an
 *   OBSERVATION: `triggerRefund` writes `triggered` and only
 *   `recordRefundObservation` writes `refunded`. Nothing here derives one from
 *   the other, which a `triggered`-only fixture pins.
 *
 * Every other value stays neutral. A tone on an ordinary state teaches the
 * operator to ignore the ones that matter.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { RETURN_LINES_COPY, RETURN_RAIL_COPY } from '../lib/return-detail.copy';

/**
 * Human wording for the declared values. An unrecognised value renders
 * verbatim — it describes a real parcel, and a build that does not recognise it
 * should say what the server said rather than blank the cell.
 */
const CUSTODY_LABEL: Record<string, string> = {
  advised: 'Announced',
  in_transit: 'On the way',
  received: 'Received',
  disposed: 'Handled',
  not_returned: 'Never arrived',
};

const MONEY_LABEL: Record<string, string> = {
  not_refundable: 'No refund due',
  pending: 'Not refunded',
  triggered: 'Refund started',
  refunded: 'Refunded',
  denied: 'Refund refused',
  in_doubt: 'Refund outcome unconfirmed',
};

interface ReturnLineStateChipProps {
  value: string;
  /** Which vocabulary to read `value` against. */
  axis: 'custody' | 'money';
  /**
   * Whether OpenLinker drives this axis. Defaults TRUE since #2378 — Wave 2
   * writes both rails. A caller passing `false` still gets the Wave-1c
   * not-tracked-yet rendering, which is what a surface reading an undriven axis
   * should say.
   *
   * **No caller passes `false` today**, so that branch and its copy are
   * currently unrendered. Kept deliberately, not dead: it is the honest
   * rendering for a surface that reads an axis nothing writes, and the next one
   * to appear (a source-projection view, an undriven axis on a new adapter)
   * needs it. Delete the branch and its copy together, or neither.
   */
  tracked?: boolean;
  /** The source's display name, for the `refunded` attribution. */
  sourceName?: string | null;
}

export function ReturnLineStateChip({
  value,
  axis,
  tracked = true,
  sourceName = null,
}: ReturnLineStateChipProps): ReactElement {
  const label = (axis === 'custody' ? CUSTODY_LABEL : MONEY_LABEL)[value] ?? value;
  const railLabel = axis === 'custody' ? RETURN_RAIL_COPY.custodyLabel : RETURN_RAIL_COPY.moneyLabel;

  if (!tracked) {
    return (
      <span className="returns-line-state" title={RETURN_LINES_COPY.notTrackedYetHint}>
        <StatusBadge tone="neutral" compact>
          {label}
        </StatusBadge>{' '}
        <span className="text-muted">{RETURN_LINES_COPY.notTrackedYet}</span>
      </span>
    );
  }

  const isInDoubt = axis === 'money' && value === 'in_doubt';
  const isRefunded = axis === 'money' && value === 'refunded';

  return (
    <span className="returns-line-state">
      <span className="returns-rail__label">{railLabel}</span>{' '}
      <StatusBadge tone={isInDoubt ? 'warning' : 'neutral'} compact>
        {label}
      </StatusBadge>
      {isInDoubt ? (
        <span className="returns-rail__note returns-rail__note--warning">
          {RETURN_RAIL_COPY.inDoubtNote}
        </span>
      ) : null}
      {isRefunded ? (
        <span className="returns-rail__note">{RETURN_RAIL_COPY.refundedBy(sourceName)}</span>
      ) : null}
    </span>
  );
}

/**
 * The standing sentence, rendered ONCE above the lines table.
 *
 * Copy rather than a comment: custody and money moving independently is the
 * single most misread thing about the model, and a reader of the screen needs it
 * as much as a reader of the code.
 */
export function ReturnRailsNote(): ReactElement {
  return <p className="returns-rails__note">{RETURN_RAIL_COPY.independenceNote}</p>;
}
