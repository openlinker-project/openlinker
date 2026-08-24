/**
 * Catalog Trust Module Exports
 *
 * Central export point for the catalog-trust context (#2258). Exposes the
 * service interface, domain types, tokens, and the NestJS module. The
 * concrete CatalogTrustService class is intentionally not exported —
 * consumers depend on ICatalogTrustService via CATALOG_TRUST_SERVICE_TOKEN.
 *
 * @module libs/core/src/catalog-trust
 */

// Service interface
export type { ICatalogTrustService } from './application/services/catalog-trust.service.interface';

// Domain types
export type {
  MasterCatalogRung,
  ConnectionCatalogTrust,
} from './domain/types/catalog-replication-trust.types';
export { MasterCatalogRungValues } from './domain/types/catalog-replication-trust.types';

// Module
export { CatalogTrustModule } from './catalog-trust.module';

// Tokens
export * from './catalog-trust.tokens';
