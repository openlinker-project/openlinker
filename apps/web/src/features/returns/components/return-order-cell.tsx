/**
 * Return Order Cell
 *
 * Which order a return belongs to — or the explicit statement that OpenLinker
 * could not tell.
 *
 * **Independent parts, never one ternary** (#2100's post-mortem). Folding the
 * orphan badge, the order link and the channel's own order reference into a
 * three-way ternary is exactly what made #2100's block badge unreachable behind
 * any invoice record. They are siblings here: an orphan renders the badge AND
 * the channel reference the re-attribution pass will eventually resolve it by,
 * because that reference is the operator's only lead.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { shortenId } from '../../../shared/ui/entity-label';
import { RETURNS_ORPHAN_COPY, RETURNS_ROW_COPY } from '../lib/returns-list.copy';
import type { ReturnListItem } from '../api/returns.types';

interface ReturnOrderCellProps {
  item: ReturnListItem;
}

export function ReturnOrderCell({ item }: ReturnOrderCellProps): ReactElement {
  const isOrphan = item.bucket === 'orphan';

  return (
    <span className="returns-order-cell">
      {isOrphan ? (
        // `StatusBadge` takes no `title`, so the explanation rides on a wrapper.
        // It is the one piece of copy that must always be one hover away: the
        // badge alone reads as a label, and the point is that it blocks work.
        <span title={RETURNS_ORPHAN_COPY.explanation}>
          <StatusBadge tone="error" compact>
            {RETURNS_ORPHAN_COPY.badge}
          </StatusBadge>
        </span>
      ) : null}

      {item.internalOrderId !== null ? (
        <Link to={`/orders/${item.internalOrderId}`} className="mono-text">
          {shortenId(item.internalOrderId)}
        </Link>
      ) : null}

      {item.externalOrderId !== null ? (
        <span className="mono-text text-muted" title={item.externalOrderId}>
          {item.externalOrderId}
        </span>
      ) : null}

      {isOrphan && item.externalOrderId === null ? (
        <span className="text-muted">{RETURNS_ORPHAN_COPY.short}</span>
      ) : null}
    </span>
  );
}

/** Compact label used by the mobile card subtitle, sharing this cell's rules. */
export function returnOrderSummary(item: ReturnListItem): string {
  if (item.bucket === 'orphan') {
    return item.externalOrderId !== null
      ? `${RETURNS_ORPHAN_COPY.badge} · ${item.externalOrderId}`
      : RETURNS_ORPHAN_COPY.badge;
  }
  return item.internalOrderId !== null
    ? `${RETURNS_ROW_COPY.orderLabel} ${shortenId(item.internalOrderId)}`
    : RETURNS_ROW_COPY.orderLabel;
}
