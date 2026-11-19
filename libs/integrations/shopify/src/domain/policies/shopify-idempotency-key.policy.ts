/**
 * Shopify Idempotency Key Policy
 *
 * The key a stock write sends with `@idempotent` (required since Admin API
 * 2026-04). Shopify remembers a key for 24 hours: the same key with the same
 * body answers the cached result and applies nothing; the same key with a
 * DIFFERENT body answers `IDEMPOTENCY_KEY_PARAMETER_MISMATCH`.
 *
 * Derived, not stored: a UUID-shaped SHA-256 of the connection, the caller's
 * key and the attempt number. The UUID shape is what Shopify's guide
 * recommends and keeps a long caller key (`sale:{owner}:{work}:{line}`) within
 * any length limit. The attempt number separates the compare-and-set retries
 * of ONE call, each of which carries a new `changeFromQuantity`; a job retry
 * after a crash starts again at attempt 1 and so reuses that key, which is
 * what turns a write that already landed into a parameter mismatch instead of
 * a second write.
 *
 * @module libs/integrations/shopify/src/domain/policies
 */
import { createHash } from 'node:crypto';

export function shopifyIdempotencyKey(connectionId: string, callerKey: string, attempt: number): string {
  const hex = createHash('sha256').update(`${connectionId}\n${callerKey}\n${attempt}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
