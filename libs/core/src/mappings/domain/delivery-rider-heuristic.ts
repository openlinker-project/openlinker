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
import {
  CANDIDATE_CARRIER_HEURISTICS,
  type CandidateCarrier,
  type RiderSourceDeliveryMethod,
} from './types/delivery-rider.types';

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
