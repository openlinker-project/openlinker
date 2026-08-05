/**
 * Rate Limit Status Types
 *
 * Platform-neutral, effective outbound rate-limit status for a connection
 * (#1810 Phase 4 rebase of the PrestaShop-only #1815 prerequisite).
 * `enabled: false` means no cap is in effect (neither an explicit
 * `Connection.config.rateLimit` nor the resolved adapter's
 * `AdapterMetadata.defaultRateLimit`) — every other field is absent.
 *
 * @module apps/api/src/integrations/application/types
 */
export interface EffectiveRateLimitStatus {
  enabled: boolean;
  requestsPerMinute?: number;
  maxConcurrent?: number;
  inFlight?: number;
  queued?: number;
  lastAcquiredAt?: Date | null;
}
