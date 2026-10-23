/**
 * Stock Location Override
 *
 * Operator-declared location for a connection whose master never reports one
 * (#3206). Neither shipped `InventoryMasterPort` adapter can supply a
 * `locationId` for the common case: PrestaShop only via the rarely-enabled
 * Advanced Stock Management module, WooCommerce not at all. Per ADR-058
 * decision (2), that means every position from such a master is permanently
 * pooled (`locationId IS NULL`) — which makes the OMS fulfilment router's
 * `loadStock()` skip it, so an install can have active locations and routable
 * rules and still resolve every line `unfulfillable`.
 *
 * This helper does NOT let the sync invent an answer the master declined to
 * give — that stays forbidden by ADR-058. It reads a fact the OPERATOR
 * supplied, once, explicitly, per connection. `MasterInventorySyncService` is
 * the sole consumer, and applies it as `inventory.locationId ?? override`
 * — a real adapter-reported location always wins, so the override becomes a
 * silent no-op the day an adapter starts reporting genuine locations.
 *
 * Pure helper (no I/O) — mirrors the `readStockSafetyBuffer` /
 * `readPricingRule` config-coercion precedent in the identifier-mapping
 * context, but lives here because `inventory` is its only consumer.
 *
 * @module libs/core/src/inventory/domain/types
 */
import type { ConnectionConfig } from '@openlinker/core/identifier-mapping';

/**
 * Config key holding the per-connection location override on
 * `Connection.config`.
 */
export const STOCK_LOCATION_OVERRIDE_CONFIG_KEY = 'stockLocationOverride';

/**
 * Read the per-connection stock-location override from a connection config.
 *
 * Coerces defensively: a missing, blank, or non-string value yields `null`
 * (no override — pooled stock stays pooled, the pre-#3206 behaviour).
 * Whether the id actually names a location this install still has is a
 * write-time concern (`ConnectionService.create`/`.update`, #3206) — this
 * read never touches storage, so it cannot re-validate that on every sync.
 */
export function readStockLocationOverride(
  config: ConnectionConfig | null | undefined
): string | null {
  if (!config) {
    return null;
  }
  const raw = config[STOCK_LOCATION_OVERRIDE_CONFIG_KEY];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  return raw.trim();
}
