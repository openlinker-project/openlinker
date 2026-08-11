/**
 * Analytics Trust Module Exports
 *
 * Central export point for the analytics-trust context (#1982). Exposes
 * the service interface, domain types, tokens, and the NestJS module.
 * The concrete AnalyticsTrustService class is intentionally not exported —
 * consumers depend on IAnalyticsTrustService via ANALYTICS_TRUST_SERVICE_TOKEN.
 *
 * @module libs/core/src/analytics-trust
 */

// Service interface
export type { IAnalyticsTrustService } from './application/services/analytics-trust.service.interface';

// Domain types
export type {
  ConnectionIngestionStatus,
  ConnectionIngestionTrust,
  AnalyticsTrustSnapshot,
} from './domain/types/connection-ingestion-trust.types';
export {
  ConnectionIngestionStatusValues,
  STALE_THRESHOLD_MULTIPLIER,
} from './domain/types/connection-ingestion-trust.types';

// Module
export { AnalyticsTrustModule } from './analytics-trust.module';

// Tokens
export * from './analytics-trust.tokens';
