/**
 * Rate Limit Status Types
 *
 * Platform-neutral, effective outbound rate-limit status for a connection
 * (#1810 Phase 4 rebase of the PrestaShop-only #1815 prerequisite).
 *
 * `enabled` describes the SHARED OUTBOUND LIMITER only — `false` means neither
 * an explicit `Connection.config.rateLimit` nor the resolved adapter's
 * `AdapterMetadata.defaultRateLimit` applies, and the limiter's own counters
 * are absent. It has never meant "nothing paces this connection", and since
 * #2229 the projection says so out loud: `resolveConcurrency` reports a
 * ceiling applied BELOW the limiter, inside an adapter's own resolver, and is
 * independent of `enabled` in both directions.
 *
 * @module apps/api/src/integrations/application/types
 */
import type { ResolveConcurrencyCeiling } from '@openlinker/core/listings';

export interface EffectiveRateLimitStatus {
  enabled: boolean;
  requestsPerMinute?: number;
  maxConcurrent?: number;
  inFlight?: number;
  queued?: number;
  lastAcquiredAt?: Date | null;
  /**
   * In-flight ceiling the connection's category-resolve path enforces (#2229),
   * as declared by its own adapter. Absent means no adapter reported one —
   * either the destination declares no ceiling, or its adapter could not be
   * resolved (a configuration state, never a claim that nothing paces it).
   */
  resolveConcurrency?: ResolveConcurrencyCeiling;
}
