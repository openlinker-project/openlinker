/**
 * Group Failed Shipments By Cause
 *
 * Cause-first triage grouping for the `/shipments` list (#1826). Fuzzy-groups
 * `failed` shipments sharing a normalised `errorMessage` so an operator can
 * fix the shared root cause (e.g. a bad sender postcode) once instead of
 * regenerating each shipment individually, which would just re-fail until the
 * cause is fixed at the source.
 *
 * Known limitation: `ShippingProviderRejectionException` carries a structured
 * `providerCode`/`providerName` discriminator, but only the free-text
 * `message` is persisted onto `Shipment.errorMessage` — `providerCode` is
 * logged, never persisted or exposed via the API. This normalised-text match
 * is a known-inferior stand-in for a real `providerCode` column, not a fully
 * robust heuristic.
 *
 * @module apps/web/src/features/shipments/lib
 */
import type { Shipment } from '../api/shipments.types';

/**
 * Lowercase and strip digit runs (order numbers, ids) AND any surrounding
 * punctuation residue they'd otherwise leave behind, so two carrier messages
 * differing only by an embedded reference number — including one quoted or
 * flanked by punctuation, e.g. `sender postcode "22-213" invalid` vs.
 * `sender postcode "22213" invalid` — normalise to the same key. Digits are
 * replaced with a space (not deleted outright) so two words that only
 * digits separated don't get glued together; a following pass strips every
 * remaining non-letter character the same way, then whitespace collapses
 * and trims. Order matters: stripping digits *before* trimming means a
 * digit run sitting at the message boundary doesn't leave a stray leading/
 * trailing space that a trim-then-strip ordering would miss.
 */
export function normaliseErrorMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FailedShipmentCauseGroup {
  /** The connection every member shipment shares — see `groupKey` below for
   *  why this is part of the group identity, not just a display field. */
  connectionId: string;
  cause: string;
  shipments: Shipment[];
}

/** Composite grouping key — cause alone is not enough: two DIFFERENT
 *  connections (e.g. two carrier accounts for two warehouses) misconfigured
 *  the same way would otherwise collapse into one group, and the triage
 *  strip's "fix the connection" CTA can only ever link to one connection. */
function groupKey(connectionId: string, cause: string): string {
  return `${connectionId}::${cause}`;
}

/**
 * Groups `failed` shipments (with a non-null `errorMessage`) by normalised
 * cause WITHIN the same connection. Only groups with 2 or more members
 * qualify for the triage strip — a lone failure has nothing to triage
 * against. Callers pass only the currently-loaded page of rows; there is no
 * cross-page/global aggregation.
 */
export function groupFailedShipmentsByCause(
  shipments: readonly Shipment[],
): FailedShipmentCauseGroup[] {
  const byKey = new Map<string, FailedShipmentCauseGroup>();
  for (const shipment of shipments) {
    if (shipment.status !== 'failed' || !shipment.errorMessage) continue;
    const cause = normaliseErrorMessage(shipment.errorMessage);
    const key = groupKey(shipment.connectionId, cause);
    const group = byKey.get(key);
    if (group) {
      group.shipments.push(shipment);
    } else {
      byKey.set(key, { connectionId: shipment.connectionId, cause, shipments: [shipment] });
    }
  }
  return Array.from(byKey.values()).filter((group) => group.shipments.length >= 2);
}
