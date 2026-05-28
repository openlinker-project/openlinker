/**
 * Shipment Tracking Link
 *
 * Renders a `Shipment.trackingNumber` as either an external link (when
 * `buildCarrierTrackingUrl` resolves) or copy-text-only (when not — null
 * carrier, null tracking, or unknown carrier value). External link gets a
 * visible icon + verbose `aria-label` per the style guide's accessibility
 * rules.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import {
  buildCarrierTrackingUrl,
  getCarrierDisplayName,
  type Shipment,
} from '../../shipments';

interface ShipmentTrackingLinkProps {
  shipment: Shipment;
}

export function ShipmentTrackingLink({ shipment }: ShipmentTrackingLinkProps): ReactElement | null {
  if (!shipment.trackingNumber) {
    return null;
  }

  const url = buildCarrierTrackingUrl(shipment);
  const carrierName = getCarrierDisplayName(shipment.carrier);

  if (!url) {
    // No deep-link available (null carrier, unknown carrier) — render the
    // tracking number as monospace copy-text. Operator can paste into the
    // appropriate tracker themselves.
    return <span className="mono-text">{shipment.trackingNumber}</span>;
  }

  const ariaLabel = carrierName
    ? `Track shipment on ${carrierName} (opens in new tab)`
    : 'Track shipment (opens in new tab)';

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="shipment-tracking-link"
      aria-label={ariaLabel}
    >
      <span className="mono-text">{shipment.trackingNumber}</span>
      <svg
        className="shipment-tracking-link__icon"
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 3.5H3.5A1.5 1.5 0 002 5v7.5A1.5 1.5 0 003.5 14h7.5a1.5 1.5 0 001.5-1.5V10" />
        <path d="M14 2v4.5M14 2H9.5M14 2L7.5 8.5" />
      </svg>
    </a>
  );
}
