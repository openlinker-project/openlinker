/**
 * Delivery Rider Heuristic
 *
 * Pure mapping of a raw source delivery method to a candidate carrier (#1792),
 * reading the single-source-of-truth {@link CANDIDATE_CARRIER_HEURISTICS} table.
 * No I/O, no framework deps — the heuristic half of the delivery rider, kept
 * pure and independently testable, and deliberately isolated from any routing
 * decision (its output only picks which hint to show, never where a parcel goes).
 *
 * @module libs/core/src/mappings/domain
 */
import type {
  CandidateCarrier,
  CarrierHeuristicEntry,
  RiderSourceDeliveryMethod,
} from './types/delivery-rider.types';

/**
 * The single-source-of-truth heuristic table mapping a raw source delivery
 * method to a candidate carrier `platformType`. Seeded with the carriers OL
 * supports today; adding a carrier is a one-line entry here.
 *
 * Match semantics: a case-insensitive substring test of any keyword against the
 * method's `name` + `typeId`. `platformType` MUST match the carrier adapter's
 * manifest `platformType` (`inpost`, `dpd`) so the connection/registry lookups
 * key correctly.
 */
export const CANDIDATE_CARRIER_HEURISTICS: readonly CarrierHeuristicEntry[] = [
  { platformType: 'inpost', displayName: 'InPost', keywords: ['paczkomat', 'inpost'] },
  { platformType: 'dpd', displayName: 'DPD', keywords: ['dpd'] },
];

/**
 * Map a source delivery method to a candidate carrier via keyword/alias match,
 * or `null` when nothing matches. First matching table entry wins (table order
 * is the precedence). Case-insensitive substring test over `name` + `typeId`.
 */
export function matchCandidateCarrier(
  method: RiderSourceDeliveryMethod,
): CandidateCarrier | null {
  const haystack = `${method.name ?? ''} ${method.typeId ?? ''}`.toLowerCase();
  if (haystack.trim() === '') {
    return null;
  }
  for (const entry of CANDIDATE_CARRIER_HEURISTICS) {
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      return { platformType: entry.platformType, displayName: entry.displayName };
    }
  }
  return null;
}
