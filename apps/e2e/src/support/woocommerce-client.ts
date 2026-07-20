/**
 * WooCommerce REST client factory
 *
 * Builds a `WooCommerceRestClient` for a given connection, resolving the
 * consumer key/secret from the environment (never from the OL connection API,
 * which never returns credentials) and the site URL from the connection's own
 * `config.siteUrl`. Returns `null` when any prerequisite is missing so callers
 * can `test.skip` rather than throw — mirrors the `buildWooClient` /
 * `buildPrestashopClient` helpers in `tests/golden-path/full-flow.spec.ts`,
 * extracted here because the WooCommerce-parity suite (#1571) needs the same
 * construction across several spec files.
 *
 * @module support
 */
import type { Connection } from '../api/api.types';
import { WooCommerceRestClient } from '../api/woocommerce-rest';

export function buildWooCommerceClient(connection: Connection | undefined): WooCommerceRestClient | null {
  if (!connection) return null;
  const consumerKey = process.env.OL_WC_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.OL_WC_CONSUMER_SECRET?.trim();
  const siteUrl = readConfigString(connection.config, 'siteUrl');
  if (!consumerKey || !consumerSecret || !siteUrl) return null;
  return new WooCommerceRestClient({ siteUrl, consumerKey, consumerSecret });
}

function readConfigString(config: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = config?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
