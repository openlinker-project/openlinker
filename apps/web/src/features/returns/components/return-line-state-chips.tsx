/**
 * Return Line State Chips
 *
 * The two orthogonal per-line axes: where the goods are, and where the refund
 * is (ADR-060 — they are never collapsed, because a marketplace routinely
 * refunds before the parcel arrives).
 *
 * **Wave 1c writes neither.** Every line arrives at its default, so these render
 * the default value together with the plain statement that OpenLinker is not
 * following it yet. They are shown rather than hidden for two reasons: an
 * operator who cannot see that the goods are untracked will assume they are
 * tracked, and Wave 2 then lights the column up instead of adding one.
 *
 * The tone is always neutral. A tone chosen from a value nothing advances would
 * be a confident signal about something OpenLinker does not know.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { RETURN_LINES_COPY } from '../lib/return-detail.copy';

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
   * Whether OpenLinker actually drives this axis yet. Always false in Wave 1c;
   * the prop exists so Wave 2 flips one call site rather than rewriting this.
   */
  tracked?: boolean;
}

export function ReturnLineStateChip({
  value,
  axis,
  tracked = false,
}: ReturnLineStateChipProps): ReactElement {
  const label = (axis === 'custody' ? CUSTODY_LABEL : MONEY_LABEL)[value] ?? value;

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

  return (
    <StatusBadge tone="neutral" compact>
      {label}
    </StatusBadge>
  );
}
