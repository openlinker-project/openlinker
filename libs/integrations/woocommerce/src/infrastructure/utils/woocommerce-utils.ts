/**
 * WooCommerce Utilities
 *
 * Pure helper functions shared across WooCommerce adapters. No I/O, no
 * framework dependencies.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/utils
 */

/**
 * Normalise a WooCommerce _gmt field to a valid UTC ISO 8601 string.
 *
 * WC REST API v3 returns _gmt fields without Z suffix ("2024-01-15T10:30:00").
 * Fallback chain:
 *   1. gmt present → append Z if missing
 *   2. gmt absent, local present → append Z to local field
 *   3. both absent → epoch sentinel — detectable, always sorts before real timestamps
 */
export function normGmt(gmt: string, local: string): string {
  const base = gmt || local;
  if (!base) return new Date(0).toISOString();
  return base.endsWith('Z') ? base : base + 'Z';
}
