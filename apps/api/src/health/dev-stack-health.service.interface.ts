/**
 * Dev Stack Health Service Interface
 *
 * Defines the contract for development stack health checking operations.
 * Checks connectivity and health of PostgreSQL, Redis, and PrestaShop services.
 * PrestaShop is treated as an external dependency - if unreachable, returns
 * degraded status rather than error.
 *
 * @module apps/api/src/health
 */
import type { InternalHealthResponse, DevStackHealthResponse } from './dev-stack-health.types';

export interface IDevStackHealthService {
  checkInternalHealth(): Promise<InternalHealthResponse>;
  checkDevStackHealth(): Promise<DevStackHealthResponse>;
}
