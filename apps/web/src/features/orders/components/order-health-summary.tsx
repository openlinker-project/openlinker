/**
 * Order Health Summary
 *
 * Derived three-cell health strip for the order-detail page (#924): Sync (from
 * per-destination `syncStatus`), Fulfillment (from the shipments query +
 * shipping capability), and Total (from the parsed snapshot totals). Pure
 * presentation over values derived in `../lib/order-health`.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { ConnectionEntityLabel } from '../../connections';
import { formatAmount } from '../../../shared/format/format-amount';
import type { OrderSyncStatus } from '../api/orders.types';
import type { ParsedOrderTotals } from '../api/order-snapshot.schema';
import {
  fulfillmentLabel,
  rollupSyncStatus,
  syncCellLabel,
  type FulfillmentState,
} from '../lib/order-health';

interface OrderHealthSummaryProps {
  syncStatus: OrderSyncStatus[];
  fulfillment: FulfillmentState;
  totals?: ParsedOrderTotals;
  itemCount: number;
  /** First failed destination — rendered as the Sync cell hint. */
  failedDestinationId?: string | null;
  /** Shipping capability / shipments still resolving — show a neutral placeholder. */
  fulfillmentPending?: boolean;
}

export function OrderHealthSummary({
  syncStatus,
  fulfillment,
  totals,
  itemCount,
  failedDestinationId,
  fulfillmentPending = false,
}: OrderHealthSummaryProps): ReactElement {
  const rollup = rollupSyncStatus(syncStatus);
  const alarm = rollup.failed > 0;

  const fulfillmentHint = fulfillmentPending
    ? 'Checking…'
    : fulfillment === 'unavailable'
      ? 'No shipping destination'
      : alarm && fulfillment === 'not-shipped'
        ? 'Blocked until sync succeeds'
        : fulfillment === 'not-shipped'
          ? 'Awaiting dispatch'
          : null;

  return (
    <div className="order-health" role="group" aria-label="Order health">
      <div className={`order-health__cell${alarm ? ' order-health__cell--alarm' : ''}`}>
        <div className="order-health__k">Sync</div>
        <div className={`order-health__v${alarm ? ' order-health__v--alarm' : ''}`}>{syncCellLabel(rollup)}</div>
        <div className="order-health__hint">
          {alarm && failedDestinationId ? (
            <ConnectionEntityLabel connectionId={failedDestinationId} showId={false} />
          ) : rollup.total === 0 ? (
            'No destinations configured'
          ) : (
            'All destinations reconciled'
          )}
        </div>
      </div>

      <div className="order-health__cell">
        <div className="order-health__k">Fulfillment</div>
        <div className="order-health__v">{fulfillmentPending ? '—' : fulfillmentLabel(fulfillment)}</div>
        {fulfillmentHint ? <div className="order-health__hint">{fulfillmentHint}</div> : null}
      </div>

      <div className="order-health__cell">
        <div className="order-health__k">Total</div>
        <div className="order-health__v mono-text tabular">
          {totals ? formatAmount(totals.total, totals.currency) : '—'}
        </div>
        <div className="order-health__hint">
          {itemCount > 0 ? `${itemCount} item${itemCount > 1 ? 's' : ''} · source-priced` : 'No line items'}
        </div>
      </div>
    </div>
  );
}
