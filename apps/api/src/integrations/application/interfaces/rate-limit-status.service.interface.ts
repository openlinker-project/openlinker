/**
 * Rate Limit Status Service Interface
 *
 * @module apps/api/src/integrations/application/interfaces
 */
import type { EffectiveRateLimitStatus } from '../types/rate-limit-status.types';

export const RATE_LIMIT_STATUS_SERVICE_TOKEN = Symbol('IRateLimitStatusService');

export interface IRateLimitStatusService {
  /**
   * Read the live, in-memory outbound rate-limit status for a connection.
   * Never calls the destination platform, never consumes a rate-limit slot.
   *
   * @throws if the connection does not exist
   */
  getStatus(connectionId: string): Promise<EffectiveRateLimitStatus>;
}
