/**
 * Return Opened Cell
 *
 * When the return was opened, according to the source channel.
 *
 * `openedAt` is the channel's own instant and `createdAt` is when OpenLinker
 * first saw the return. They are different facts, and where the channel
 * reported nothing the fallback is LABELLED rather than substituted silently —
 * passing OpenLinker's own clock off as the channel's would misdate a return by
 * however long ingestion lagged, invisibly.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { RETURNS_ROW_COPY } from '../lib/returns-list.copy';
import type { ReturnListItem } from '../api/returns.types';

interface ReturnOpenedCellProps {
  item: ReturnListItem;
}

export function ReturnOpenedCell({ item }: ReturnOpenedCellProps): ReactElement {
  if (item.openedAt !== null) {
    return <TimeDisplay iso={item.openedAt} format="relative" />;
  }

  return (
    <span className="text-muted" title={RETURNS_ROW_COPY.recordedAtFallback}>
      <TimeDisplay iso={item.createdAt} format="relative" />
    </span>
  );
}
