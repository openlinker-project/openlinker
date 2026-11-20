/**
 * Allegro Connection Config Types
 *
 * Type definitions for Allegro connection configuration. Defines the structure
 * of connection config stored in the Connection entity's configJson field.
 *
 * This file contains types only (per engineering standards).
 *
 * @module libs/integrations/allegro/src/domain/types
 */
import type { ShipmentAddress } from '@openlinker/core/shipping';
import type { AllegroSellerDefaultsConfig } from './allegro-seller-defaults.types';

/**
 * Allegro environment (sandbox or production)
 */
export const AllegroEnvironmentValues = ['sandbox', 'production'] as const;

/**
 * Allegro environment type
 */
export type AllegroEnvironment = (typeof AllegroEnvironmentValues)[number];

/**
 * Allegro Connection Config
 *
 * Configuration for an Allegro connection. Stored in Connection.configJson.
 * Credentials are stored separately via credentialsRef indirection.
 */
/**
 * The sender a "Wysyłam z Allegro" shipment ships FROM. Allegro's create-command
 * requires `sender` on every shipment (live sandbox 400 `input.sender`), so it is
 * connection configuration the same way InPost's and DPD's sender is.
 */
export interface AllegroSenderContact {
  name?: string;
  company?: string;
  email: string;
  /** International format with a prefix (Allegro makes the prefix mandatory from 2026-10-01). */
  phone: string;
  address: ShipmentAddress;
}

export interface AllegroConnectionConfig {
  /**
   * Allegro environment (sandbox or production)
   */
  environment: AllegroEnvironment;

  /**
   * Allegro REST API base URL (optional). When omitted, the per-environment
   * default is resolved by `getAllegroRestApiBaseUrl` (the `api.` host) in
   * `infrastructure/http/allegro-hosts.ts`.
   */
  apiBaseUrl?: string;

  /**
   * Allegro image-upload base URL (optional, defaults based on environment).
   * The image-binary endpoint lives on a different host from the rest of the
   * Allegro API, so each connection holds two host configurations.
   * - Sandbox: https://upload.allegro.pl.allegrosandbox.pl
   * - Production: https://upload.allegro.pl
   */
  uploadBaseUrl?: string;

  /**
   * Connection-level seller defaults required by `POST /sale/product-offers`
   * — `location` (every offer), plus `responsibleProducerId` and
   * `safetyInformation` for the inline-product path. See #430. Optional at
   * the type level so existing connections without it parse cleanly; offer
   * creation fails fast with `SELLER_DEFAULTS_NOT_CONFIGURED` if missing.
   */
  sellerDefaults?: AllegroSellerDefaultsConfig;

  /**
   * Allegro seller/account id (`GET /me` → `id`) captured at OAuth completion.
   * The stable anchor an in-place re-auth (#819) checks against to verify the
   * new token authorizes the same seller (#820). Optional at the type level so
   * connections created before #820 parse cleanly — they backfill on next
   * re-auth.
   */
  sellerId?: string;

  /**
   * Sender for Allegro Delivery shipments. Optional so connections that never
   * generate labels stay valid; generating a label without it is refused
   * pre-call with a readable error rather than sent to Allegro to be rejected.
   */
  senderAddress?: AllegroSenderContact;
}


