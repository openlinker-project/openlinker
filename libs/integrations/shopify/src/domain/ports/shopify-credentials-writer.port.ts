/**
 * Shopify Credentials Writer Port
 *
 * Writes rotated OAuth tokens back to the connection's stored credentials.
 * Shopify's expiring offline tokens come with a refresh token that is
 * REPLACED on every refresh, so a refresh that is not persisted strands the
 * connection once the old refresh token stops working. Implemented in the
 * plugin's NestJS module over the host's credentials service, which the
 * `HostServices` bag does not carry.
 *
 * @module libs/integrations/shopify/src/domain/ports
 */
import type { ShopifyCredentials } from '../types/shopify-credentials.types';

export interface ShopifyCredentialsWriterPort {
  /** Replace the whole stored credential blob behind `credentialsRef`. */
  replace(credentialsRef: string, credentials: ShopifyCredentials): Promise<void>;
}
