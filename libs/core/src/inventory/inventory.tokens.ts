/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the inventory module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/inventory
 */

// Token for dependency injection (interfaces can't be used as values)
export const INVENTORY_REPOSITORY_TOKEN = Symbol('InventoryRepositoryPort');
export const INVENTORY_SERVICE_TOKEN = Symbol('IInventoryService');
export const INVENTORY_SYNC_SERVICE_TOKEN = Symbol('IInventorySyncService');
export const MASTER_INVENTORY_SYNC_SERVICE_TOKEN = Symbol('IMasterInventorySyncService');
export const INVENTORY_QUERY_SERVICE_TOKEN = Symbol('IInventoryQueryService');

// Inventory locations (#2313, ADR-058 decision 1)
export const LOCATION_REPOSITORY_TOKEN = Symbol('LocationRepositoryPort');
export const LOCATION_SERVICE_TOKEN = Symbol('ILocationService');

// Available-to-promise seam (#2321, ADR-061)
export const AVAILABILITY_SERVICE_TOKEN = Symbol('IAvailabilityService');
export const RESERVATION_LEDGER_READER_TOKEN = Symbol('ReservationLedgerReaderPort');
// Advisory reservation ledger, write half (#2343, ADR-061)
export const RESERVATION_REPOSITORY_TOKEN = Symbol('ReservationRepositoryPort');
// State-dependent expiry sweep (#2346, REVIEW C1)
export const RESERVATION_EXPIRY_SERVICE_TOKEN = Symbol('IReservationExpiryService');
export const RESERVATION_OBLIGATION_READERS_TOKEN = Symbol('ObligationReaders');
// Reservation shortfall episodes (#2349, design § 4.2 story I6)
export const RESERVATION_SHORTFALL_REPOSITORY_TOKEN = Symbol(
  'ReservationShortfallRepositoryPort'
);
export const RESERVATION_SHORTFALL_SERVICE_TOKEN = Symbol('IReservationShortfallService');
// Order-shaped seam over the ledger (#2344, ADR-061)
export const RESERVATION_SERVICE_TOKEN = Symbol('IReservationService');
// Connection-provenance backfill (#2317, ADR-058 ladder step (ii))
export const INVENTORY_PROVENANCE_BACKFILL_SERVICE_TOKEN = Symbol(
  'IInventoryProvenanceBackfillService'
);
