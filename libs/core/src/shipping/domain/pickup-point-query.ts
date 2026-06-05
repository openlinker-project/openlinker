/**
 * Pickup-Point Query Normalization
 *
 * Pure helpers that derive stable cache/frequency keys from a
 * `FindPickupPointsQuery` (#849). Two derivations, deliberately distinct:
 *
 * - `pickupPointFrequencyMember` — the ZSET member for query-frequency
 *   tracking. **Excludes `limit`** (popularity of a locality query must not
 *   fragment by page size) and is a stable JSON encoding so the stats adapter
 *   can reconstruct the original query for the daily re-warm
 *   (`parsePickupPointFrequencyMember`).
 * - `pickupPointSearchCacheKey` — the result-cache key. **Includes `limit`**:
 *   a `limit=5` cache entry must not satisfy a later `limit=50` query with a
 *   truncated list.
 *
 * Domain-only — zero framework imports.
 *
 * @module libs/core/src/shipping/domain
 */
import type { FindPickupPointsQuery } from './types/pickup-point.types';

/** The query dimensions that identify a search, sans `limit`. */
interface NormalizedQueryParts {
  city?: string;
  postalCode?: string;
  searchText?: string;
}

function normalizeField(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const collapsed = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return collapsed.length > 0 ? collapsed : undefined;
}

/**
 * Normalize the identity dimensions of a query. Empty/whitespace-only fields
 * collapse to `undefined` so they don't fragment the key. Keys are emitted in
 * a fixed order for a stable JSON encoding.
 */
function normalizeParts(query: FindPickupPointsQuery): NormalizedQueryParts {
  const parts: NormalizedQueryParts = {};
  const city = normalizeField(query.city);
  const postalCode = normalizeField(query.postalCode);
  const searchText = normalizeField(query.searchText);
  if (city !== undefined) parts.city = city;
  if (postalCode !== undefined) parts.postalCode = postalCode;
  if (searchText !== undefined) parts.searchText = searchText;
  return parts;
}

/**
 * Stable frequency-tracking member for a query — limit-excluded. Used as the
 * ZSET member and round-tripped back to a `FindPickupPointsQuery` by the
 * daily re-warm via {@link parsePickupPointFrequencyMember}.
 */
export function pickupPointFrequencyMember(query: FindPickupPointsQuery): string {
  return JSON.stringify(normalizeParts(query));
}

/**
 * Reconstruct a `FindPickupPointsQuery` from a frequency member. Returns an
 * empty query (`{}`) if the member is not parseable, so a corrupt entry
 * degrades to a broad re-warm rather than throwing.
 */
export function parsePickupPointFrequencyMember(member: string): FindPickupPointsQuery {
  try {
    const parsed: unknown = JSON.parse(member);
    if (parsed === null || typeof parsed !== 'object') {
      return {};
    }
    const { city, postalCode, searchText } = parsed as NormalizedQueryParts;
    return { city, postalCode, searchText };
  } catch {
    return {};
  }
}

/**
 * Result-cache key for a query — limit-inclusive. `limit` is appended so a
 * narrower cached list can't wrongly satisfy a wider request.
 */
export function pickupPointSearchCacheKey(query: FindPickupPointsQuery): string {
  const limit = typeof query.limit === 'number' && query.limit > 0 ? query.limit : 'none';
  return `${pickupPointFrequencyMember(query)}::limit=${limit}`;
}
