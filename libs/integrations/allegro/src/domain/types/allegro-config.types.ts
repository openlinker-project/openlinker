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
}


