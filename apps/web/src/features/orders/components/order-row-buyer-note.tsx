/**
 * OrderRowBuyerNote (#3539, mockup M2 `list`, row expansion)
 *
 * The whole note inside an expanded orders-list row. The list read carries no
 * note text, so this reads the order's detail ON EXPANSION (the row detail is
 * only mounted once opened) instead of widening the list payload - one request
 * for the one row an operator opened, never one per row on the page.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { readBuyerNote } from '../api/buyer-note.schema';
import { useOrderQuery } from '../hooks/use-order-query';
import { BUYER_NOTE_COPY as COPY } from '../lib/buyer-note.copy';

export function OrderRowBuyerNote({ internalOrderId }: { internalOrderId: string }): ReactElement {
  const query = useOrderQuery(internalOrderId);

  let body: ReactElement;
  if (query.isPending) {
    body = <span className="text-muted">{COPY.rowLoading}</span>;
  } else if (query.data === undefined) {
    body = <span className="text-muted">{COPY.rowUnreadable}</span>;
  } else {
    const view = readBuyerNote(query.data);
    body =
      view.kind === 'text' ? (
        <span
          className="buyer-note__text"
          lang="und"
          style={{ fontSize: '0.8125rem' }}
          data-testid="order-row-buyer-note-text"
        >
          {view.text}
        </span>
      ) : (
        <span className="text-muted">{COPY.textNotStored}</span>
      );
  }

  return (
    <div className="orders-detail__field orders-detail__field--wide">
      <dt className="orders-detail__label">{COPY.rowFieldLabel}</dt>
      <dd className="orders-detail__value" data-testid="order-row-buyer-note">
        {body}
      </dd>
    </div>
  );
}
