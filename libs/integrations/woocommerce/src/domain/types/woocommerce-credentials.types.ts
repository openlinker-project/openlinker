/**
 * WooCommerce Credentials Types
 *
 * The secret half of a WooCommerce connection — the REST API consumer key and
 * consumer secret generated in WP Admin → WooCommerce → Settings → Advanced →
 * REST API. Resolved via the host CredentialsResolverPort from
 * `connection.credentialsRef`; never logged or returned in API responses.
 *
 * @module libs/integrations/woocommerce/src/domain/types
 */

export interface WooCommerceCredentials {
  consumerKey: string; // ck_...
  consumerSecret: string; // cs_...
}
