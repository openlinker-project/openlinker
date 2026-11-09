/**
 * Order payment marker (#3963)
 *
 * Shown on an orders-list row ONLY when a shop still shows the order unpaid
 * and OpenLinker gave up sending the payment. A healthy row carries nothing,
 * so the marker stands out rather than adding noise to every row.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { renderRich, useMessages } from '../../../shared/i18n';
import { ConnectionEntityLabel } from '../../connections';
import type { OrderPaymentWritebackEntry } from '../api/orders.types';

interface OrderPaymentMarkerProps {
  entries: readonly OrderPaymentWritebackEntry[] | null | undefined;
}

export function OrderPaymentMarker({ entries }: OrderPaymentMarkerProps): ReactElement | null {
  const copy = useMessages('orders').paymentWriteback;
  const problems = (entries ?? []).filter((e) => e.problem);
  if (problems.length === 0) return null;
  return (
    <span className="order-payment-marker">
      <span className="order-payment-marker__dot" aria-hidden="true" />
      {problems.length === 1 ? (
        <span>
          {renderRich(copy.listMarker, {
            shop: () => <ConnectionEntityLabel connectionId={problems[0].destinationConnectionId} showId={false} />,
          })}
        </span>
      ) : (
        copy.listMarkerGeneric
      )}
    </span>
  );
}
