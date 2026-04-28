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
export interface AllegroConnectionConfig {
  /**
   * Allegro environment (sandbox or production)
   */
  environment: AllegroEnvironment;

  /**
   * Allegro API base URL (optional, defaults based on environment)
   * - Sandbox: https://api.allegro.pl.allegrosandbox.pl
   * - Production: https://api.allegro.pl
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
}


