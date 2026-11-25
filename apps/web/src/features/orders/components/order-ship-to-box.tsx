/**
 * Order ship-to box (#4286)
 *
 * The top of the Shipping tab: what is being shipped how, to whom, and where.
 * Reads the parsed snapshot only (display-only; the address is whatever the
 * snapshot kept under the PII setting, so a missing name or street simply does
 * not render).
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import type { ParsedAddress, ParsedOrderPickupPoint } from '../api/order-snapshot.schema';

export function OrderShipToBox({
  methodName,
  address,
  pickupPoint,
}: {
  methodName: string | null;
  address: ParsedAddress | undefined;
  pickupPoint: ParsedOrderPickupPoint | undefined;
}): ReactElement | null {
  const copy = useMessages('orders').orderDetailPage.shipTo;
  const name = [address?.firstName, address?.lastName].filter(Boolean).join(' ');
  const cityLine = [address?.postalCode, address?.city].filter(Boolean).join(' ');
  const lines = [name || address?.company, address?.address1, address?.address2, cityLine, address?.country].filter(
    (line): line is string => Boolean(line),
  );
  if (!methodName && lines.length === 0 && !pickupPoint) return null;
  return (
    <div className="order-ship-to">
      {methodName ? (
        <div className="order-ship-to__method">
          <span className="order-ship-to__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
          </span>
          <strong>{methodName}</strong>
        </div>
      ) : null}
      {lines.length > 0 || pickupPoint ? (
        <div className="order-ship-to__box">
          <div className="order-ship-to__address">
            <span className="order-ship-to__label">{copy.title}</span>
            {lines.map((line, index) => (
              <span key={`${index}-${line}`} className={index === 0 && name ? 'order-ship-to__name' : undefined}>
                {line}
              </span>
            ))}
          </div>
          {pickupPoint ? (
            <div className="order-ship-to__point">
              <small>{copy.pickupPoint}</small>
              <strong className="mono-text">{pickupPoint.id}</strong>
              {pickupPoint.description ? <small>{pickupPoint.description}</small> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
