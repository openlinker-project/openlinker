/**
 * Carrier-keyed Tracking URL Map
 *
 * Pure helper for composing public-tracker URLs from `Shipment.carrier` +
 * `Shipment.trackingNumber` (#769). Keyed on the **actual carrier-of-record**
 * (e.g. InPost, DPD, ORLEN), NOT on the dispatcher's `platformType` — Allegro
 * Delivery is a brokerage and the same `connectionId.platformType === 'allegro'`
 * can resolve to any of ~9 underlying carriers. See §3.0 + §3.7 of the
 * implementation plan for the architectural rationale.
 *
 * The map covers `KNOWN_CARRIER_VALUES`. Any value not in the map (null
 * carrier, null trackingNumber, plugin-registered values) returns `null` — the
 * panel falls back to copy-text-only without breaking the UX.
 *
 * **Promotion seam** (per plan §3.7): when #834 PS-fulfilled rows surface
 * PS-specific carrier names, promote URL composition to a per-plugin
 * `PlatformContribution.buildCarrierTrackingUrl(carrier, waybill)` slot. The
 * static map stays as the host-provided default fallback.
 *
 * @module apps/web/src/features/shipments/lib
 */
import type { KNOWN_CARRIER_VALUES, Shipment } from '../api/shipments.types';

const CARRIER_TRACKING_URLS: Record<string, (waybill: string) => string> = {
  inpost: (n) => `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(n)}`,
  dpd: (n) => `https://tracktrace.dpd.com.pl/findParcel?p1=${encodeURIComponent(n)}`,
  dhl: (n) => `https://mojadhl.dhl.com.pl/?awb=${encodeURIComponent(n)}`,
  orlen: (n) => `https://nadaj.orlenpaczka.pl/?numer=${encodeURIComponent(n)}`,
  'allegro-one-box': (n) =>
    `https://allegro.pl/moje-allegro/zakupy/szczegoly-przesylki?numerListu=${encodeURIComponent(n)}`,
  'allegro-one-punkt': (n) =>
    `https://allegro.pl/moje-allegro/zakupy/szczegoly-przesylki?numerListu=${encodeURIComponent(n)}`,
  'allegro-one-kurier': (n) =>
    `https://allegro.pl/moje-allegro/zakupy/szczegoly-przesylki?numerListu=${encodeURIComponent(n)}`,
  'poczta-polska': (n) => `https://emonitoring.poczta-polska.pl/?numer=${encodeURIComponent(n)}`,
  ups: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  packeta: (n) => `https://tracking.packeta.com/?id=${encodeURIComponent(n)}`,
} satisfies Record<(typeof KNOWN_CARRIER_VALUES)[number], (waybill: string) => string>;

/**
 * Resolve the public-tracker URL for a shipment, or `null` if no link is
 * available (missing tracking number, missing carrier, or unknown carrier
 * value). Pure function — no React, no DOM, trivially unit-testable.
 */
export function buildCarrierTrackingUrl(shipment: Shipment): string | null {
  if (!shipment.trackingNumber || !shipment.carrier) return null;
  const builder = CARRIER_TRACKING_URLS[shipment.carrier];
  return builder ? builder(shipment.trackingNumber) : null;
}

/**
 * Human-readable display name for a carrier value. Used by the panel's
 * "Carrier" field row and the external-link `aria-label`. Falls back to the
 * raw carrier value when unknown — operator still sees what the BE stored.
 */
const CARRIER_DISPLAY_NAMES: Record<string, string> = {
  inpost: 'InPost',
  dpd: 'DPD',
  dhl: 'DHL',
  orlen: 'ORLEN Paczka',
  'allegro-one-box': 'Allegro One Box',
  'allegro-one-punkt': 'Allegro One Punkt',
  'allegro-one-kurier': 'Allegro One Kurier',
  'poczta-polska': 'Poczta Polska',
  ups: 'UPS',
  packeta: 'Packeta',
};

export function getCarrierDisplayName(carrier: string | null): string | null {
  if (!carrier) return null;
  return CARRIER_DISPLAY_NAMES[carrier] ?? carrier;
}
