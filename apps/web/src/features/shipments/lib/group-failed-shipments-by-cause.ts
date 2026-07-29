/**
 * Group Failed Shipments By Cause
 *
 * Triage grouping for the `/shipments` list (#1826). Fuzzy-groups `failed`
 * shipments whose normalised `errorMessage` matches, so an operator sees a
 * repeated carrier message as one item instead of N unrelated-looking rows.
 *
 * What a group is NOT: proof of a shared root cause. It is a same-message
 * observation, and the strip's copy is worded accordingly. Two limits force
 * that modesty:
 *
 * 1. `ShippingProviderRejectionException` carries a structured
 *    `providerCode`/`providerName` discriminator, but only the free-text
 *    `message` is persisted onto `Shipment.errorMessage` — `providerCode` and
 *    `fieldErrors` are logged and dropped. `ShipmentDispatchService`'s own
 *    comment notes the surviving message "is often a generic 'validation
 *    error' that hides which field the provider rejected (#1428)", so a bad
 *    postcode, a missing parcel template and an over-limit COD can all arrive
 *    as the same string.
 * 2. The normalisation below is lossy by design (see `MIN_CAUSE_KEY_LENGTH`).
 *
 * This normalised-text match is a known-inferior stand-in for a real
 * `providerCode` column, not a robust cause classifier.
 *
 * @module apps/web/src/features/shipments/lib
 */
import { REDACTED_ERROR_MESSAGE, type Shipment } from '../api/shipments.types';

/**
 * Shortest normalised key still allowed to form a group.
 *
 * `normaliseErrorMessage` replaces every digit run and then every non-`[a-z\s]`
 * character with a space, so a message carrying no Latin letters normalises to
 * the empty string — `'500'` and `'404'` both become `''`, as do two unrelated
 * Cyrillic messages, and `'ERROR 4001'` / `'ERROR 5002'` both collapse to
 * `'error'`. Grouping on such a key asserts a shared cause between failures
 * that have nothing in common. Two letters cannot carry a diagnosable cause
 * either, so anything shorter than this is dropped rather than grouped.
 */
const MIN_CAUSE_KEY_LENGTH = 3;

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
    // A viewer's rows all carry the SAME server-side placeholder, which would
    // otherwise group every unrelated failure on a connection under one
    // "shared cause". The strip is admin/operator-only today, so this is a
    // belt-and-braces guard against a future caller passing viewer rows in.
    if (shipment.errorMessage === REDACTED_ERROR_MESSAGE) continue;
    const cause = normaliseErrorMessage(shipment.errorMessage);
    if (cause.length < MIN_CAUSE_KEY_LENGTH) continue;
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
