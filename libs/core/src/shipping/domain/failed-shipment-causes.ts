/**
 * Failed-shipment cause grouping (#4043)
 *
 * The rule the failed-shipment triage strips use (#1918), moved to core so the
 * summary endpoint can group failures across every page rather than the one
 * the browser holds. Two failures share a cause when they share the connection
 * and either the same exact provider code, or - when the code is coarse or
 * absent - the same code plus the same normalised carrier message. A group
 * needs at least two members: one failure is not a pattern.
 *
 * @module libs/core/src/shipping/domain
 */
import { deriveRetryabilityClass } from './provider-code-retryability';
import type { ShipmentFailedCauseGroup } from './types/shipment-query.types';

const MIN_CAUSE_KEY_LENGTH = 3;
const MIN_GROUP_SIZE = 2;

export interface FailedShipmentFacts {
  connectionId: string;
  providerCode: string | null;
  errorMessage: string | null;
}

/** An exact code names the cause on its own; a coarse one only buckets it. */
export function isExactProviderCode(providerCode: string | null): providerCode is string {
  return providerCode !== null && deriveRetryabilityClass(providerCode) !== 'unknown';
}

/** Lower case, digits and punctuation dropped, so ids and timestamps do not split a cause. */
export function normaliseErrorMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Groups failures by shared cause, largest first, at most `limit` groups. */
export function groupFailedShipmentCauses(
  shipments: readonly FailedShipmentFacts[],
  limit = 5,
): ShipmentFailedCauseGroup[] {
  const byKey = new Map<string, ShipmentFailedCauseGroup>();
  for (const shipment of shipments) {
    if (!shipment.errorMessage) continue;
    let cause: string;
    if (isExactProviderCode(shipment.providerCode)) {
      cause = shipment.providerCode;
    } else {
      const normalised = normaliseErrorMessage(shipment.errorMessage);
      if (normalised.length < MIN_CAUSE_KEY_LENGTH) continue;
      cause = `${shipment.providerCode ?? ''}::${normalised}`;
    }
    const key = `${shipment.connectionId}::${cause}`;
    const group = byKey.get(key);
    if (group) {
      group.count += 1;
    } else {
      byKey.set(key, {
        connectionId: shipment.connectionId,
        cause,
        providerCode: shipment.providerCode,
        sampleReason: shipment.errorMessage,
        count: 1,
      });
    }
  }
  return Array.from(byKey.values())
    .filter((group) => group.count >= MIN_GROUP_SIZE)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
