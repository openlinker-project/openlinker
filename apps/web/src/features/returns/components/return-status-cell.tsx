/**
 * Return Status Cell
 *
 * The one lifecycle fact Wave 1c can honestly render: whether the source
 * reported that the return was declined.
 *
 * Deliberately NOT a derived stage. The returns spec's operator stage
 * (`Awaiting parcel`, `Partially received`, …) is computed from custody and
 * money counters, and Wave 1c writes neither — the list projection carries no
 * lines at all. A stage rendered here would be derived from columns nothing
 * fills, which is a confident label for something OpenLinker does not know.
 * W2-40 owns the stage and its mirror invariant.
 *
 * `declinedAt` is stamped only from the SOURCE's own reported instant, so a
 * null is "not declined, as far as the channel has said" — the cell shows
 * nothing rather than asserting an active state.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { RETURNS_ROW_COPY } from '../lib/returns-list.copy';
import type { ReturnListItem } from '../api/returns.types';

interface ReturnStatusCellProps {
  item: ReturnListItem;
}

export function ReturnStatusCell({ item }: ReturnStatusCellProps): ReactElement | null {
  if (item.declinedAt === null) return null;

  return (
    <StatusBadge tone="warning" compact>
      {RETURNS_ROW_COPY.declined}
    </StatusBadge>
  );
}
