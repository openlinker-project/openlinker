/**
 * WooCommerce Orders Configuration Types
 *
 * Per-connection configuration for the WooCommerce OrderSource capability (#876).
 * Nested under WooCommerceConnectionConfig.orders.
 * Future capabilities (#875, #877) follow the same pattern — own sibling file.
 *
 * @module libs/integrations/woocommerce/src/domain/types
 */

export interface WooCommerceOrdersConfig {
  /**
   * Optional initial sync boundary — any JS-parseable date string.
   * When absent: no modified_after param sent — fetches all historical orders.
   * Validated by IsValidDateConstraint. Normalised via new Date(v).toISOString().
   */
  initialSyncFrom?: string;
}
