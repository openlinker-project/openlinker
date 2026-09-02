/**
 * Return Identity Cell
 *
 * Which return this row is.
 *
 * The channel's own reference is the id an operator can quote back to the
 * channel, so it leads. When the channel minted none, the OpenLinker id is
 * shown instead and LABELLED as such — a bare OL id where a channel reference
 * is expected reads as the channel's own and sends the operator looking for it
 * in a panel that has never heard of it.
 *
 * The `Recorded by you` chip marks an operator-authored return (returns spec
 * §4.2). It is a fact about provenance, not a status.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { shortenId } from '../../../shared/ui/entity-label';
import { RETURNS_ROW_COPY } from '../lib/returns-list.copy';
import type { ReturnListItem } from '../api/returns.types';

interface ReturnIdentityCellProps {
  item: ReturnListItem;
}

export function ReturnIdentityCell({ item }: ReturnIdentityCellProps): ReactElement {
  return (
    <span className="returns-identity-cell">
      {item.externalReturnId !== null ? (
        <span className="mono-text" title={item.externalReturnId}>
          {item.externalReturnId}
        </span>
      ) : (
        <span className="mono-text text-muted" title={`${RETURNS_ROW_COPY.noExternalId}: ${item.id}`}>
          {shortenId(item.id)}
        </span>
      )}

      {item.origin === 'operator_authored' ? (
        <StatusBadge tone="info" compact>
          {RETURNS_ROW_COPY.recordedByYou}
        </StatusBadge>
      ) : null}
    </span>
  );
}

/** Plain-text form for the mobile card title, sharing this cell's fallback rule. */
export function returnIdentitySummary(item: ReturnListItem): string {
  return item.externalReturnId ?? shortenId(item.id);
}
