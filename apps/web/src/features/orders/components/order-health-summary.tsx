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
import { useFormat, useMessages, usePlural } from '../../../shared/i18n';
import type { OrderHandledInOpenLinker, OrderSyncStatus } from '../api/orders.types';
import type { ParsedOrderTotals } from '../api/order-snapshot.schema';
import {
  fulfillmentLabel,
  rollupSyncStatus,
  syncCellLabel,
  type FulfillmentState,
} from '../lib/order-health';
import { resolveDestinationRoutingSyncHint } from '../lib/destination-routing';
import { isHandledInOpenLinker } from '../lib/handled-in-openlinker';

interface OrderHealthSummaryProps {
  syncStatus: OrderSyncStatus[];
  fulfillment: FulfillmentState;
  totals?: ParsedOrderTotals;
  itemCount: number;
  /** First failed destination — rendered as the Sync cell hint. */
  failedDestinationId?: string | null;
  /** Shipping capability / shipments still resolving — show a neutral placeholder. */
  fulfillmentPending?: boolean;
  /**
   * How routing narrowed this order's destination fan-out (#2703), read from the
   * persisted column. Tells a working router's decision apart from a
   * configuration that was never set up, and stops the hint claiming every
   * destination was reconciled after a partial narrowing.
   */
  destinationRoutingBlockReason?: string | null;
  /**
   * The packing position of an order OpenLinker handles itself (#3482). Consulted
   * ONLY when the rollup is empty and takes precedence over the routing reason:
   * an order with live pack-bench work is not "routed nowhere".
   */
  handledInOpenLinker?: OrderHandledInOpenLinker;
}

export function OrderHealthSummary({
  syncStatus,
  fulfillment,
  totals,
  itemCount,
  failedDestinationId,
  fulfillmentPending = false,
  destinationRoutingBlockReason,
  handledInOpenLinker,
}: OrderHealthSummaryProps): ReactElement {
  const orders = useMessages('orders');
  const copy = orders.healthSummary;
  const plural = usePlural();
  const { money } = useFormat();
  const rollup = rollupSyncStatus(syncStatus);
  const alarm = rollup.failed > 0;
  const routingHint = resolveDestinationRoutingSyncHint(
    destinationRoutingBlockReason,
    rollup.total > 0,
    orders
  );
  const handled = isHandledInOpenLinker({ handledInOpenLinker });

  const fulfillmentHint = fulfillmentPending
    ? copy.checking
    : fulfillment === 'unavailable'
      ? copy.noShippingDestination
      : alarm && fulfillment === 'not-shipped'
        ? copy.blockedUntilSync
        : fulfillment === 'not-shipped'
          ? copy.awaitingDispatch
          : null;

  return (
    <div className="order-health" role="group" aria-label={copy.ariaLabel}>
      <div className={`order-health__cell${alarm ? ' order-health__cell--alarm' : ''}`}>
        <div className="order-health__k">{copy.sync}</div>
        <div className={`order-health__v${alarm ? ' order-health__v--alarm' : ''}`}>
          {syncCellLabel(rollup, destinationRoutingBlockReason, handledInOpenLinker, orders)}
        </div>
        <div className="order-health__hint">
          {alarm && failedDestinationId ? (
            <ConnectionEntityLabel connectionId={failedDestinationId} showId={false} />
          ) : rollup.total === 0 && handled ? (
            // #3482 - handled in OpenLinker first: it has no destination rows by
            // design, and live pack-bench work is not "routed nowhere".
            orders.handledInOpenLinker.syncHint
          ) : routingHint !== null ? (
            // #2703 / #2704 - the routing reason's own hint replaces "No destinations configured" and "All
            // destinations reconciled" where either would be false.
            routingHint
          ) : rollup.total === 0 ? (
            copy.noDestinationsConfigured
          ) : (
            copy.allReconciled
          )}
        </div>
      </div>

      <div className="order-health__cell">
        <div className="order-health__k">{copy.fulfilment}</div>
        <div className="order-health__v">
          {fulfillmentPending ? '—' : fulfillmentLabel(fulfillment, orders)}
        </div>
        {fulfillmentHint ? <div className="order-health__hint">{fulfillmentHint}</div> : null}
      </div>

      <div className="order-health__cell">
        <div className="order-health__k">{copy.total}</div>
        <div className="order-health__v mono-text tabular">
          {totals ? money(totals.total, totals.currency) : '—'}
        </div>
        <div className="order-health__hint">
          {itemCount > 0 ? plural(itemCount, copy.items) : copy.noLineItems}
        </div>
      </div>
    </div>
  );
}
