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
import { interpolate, useMessages } from '../../../shared/i18n';

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
  const returnsCopy = useMessages('returns');
  const railCopy = returnsCopy.detail.rail;
  const linesCopy = returnsCopy.detail.lines;
  // An unrecognised value renders verbatim - it describes a real parcel, and a
  // build that does not recognise it should say what the server said.
  const labels: Readonly<Record<string, string>> =
    axis === 'custody' ? returnsCopy.returnLineStateChips.custody : returnsCopy.returnLineStateChips.money;
  const label = labels[value] ?? value;
  const railLabel = axis === 'custody' ? railCopy.custodyLabel : railCopy.moneyLabel;

  if (!tracked) {
    return (
      <span className="returns-line-state" title={linesCopy.notTrackedYetHint}>
        <StatusBadge tone="neutral" compact>
          {label}
        </StatusBadge>{' '}
        <span className="text-muted">{linesCopy.notTrackedYet}</span>
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
          {railCopy.inDoubtNote}
        </span>
      ) : null}
      {isRefunded ? (
        <span className="returns-rail__note">{sourceName === null
            ? railCopy.refundedByUnknownSource
            : interpolate(railCopy.refundedBy, { sourceName })}</span>
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
  const copy = useMessages('returns').detail.rail;
  return <p className="returns-rails__note">{copy.independenceNote}</p>;
}
