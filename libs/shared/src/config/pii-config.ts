/**
 * PII Configuration Utilities
 *
 * Provides configuration utilities for PII (Personally Identifiable Information)
 * storage settings. Handles reading and parsing environment variables for PII
 * storage toggle and hash salt configuration.
 *
 * @module libs/shared/src/config
 */

import { getEnv, getEnvBoolean } from './index';
import { PiiConfigurationError } from './pii-config-error';

/**
 * PII Configuration
 *
 * Configuration for PII storage settings, including storage toggle and hash salt.
 */
export interface PiiConfig {
  /**
   * Whether to store raw PII data (email, names, addresses)
   * When false, only hashes are stored
   */
  storePii: boolean;

  /**
   * Organization-level salt for PII hashing
   * Required for deterministic hashing across the system
   */
  hashSalt: string;
}

/**
 * Get PII configuration from environment variables
 *
 * Reads OL_STORE_PII (default: true) and OL_PII_HASH_SALT (required).
 * Throws error if OL_PII_HASH_SALT is not set.
 *
 * @returns PII configuration object
 * @throws Error if OL_PII_HASH_SALT is not set
 */
export function getPiiConfig(): PiiConfig {
  const storePii = getEnvBoolean('OL_STORE_PII', true);
  const hashSalt = getEnv('OL_PII_HASH_SALT');

  if (!hashSalt) {
    throw new PiiConfigurationError(
      'OL_PII_HASH_SALT environment variable is required. ' +
        'Set it to an organization-level salt value for PII hashing.',
      'OL_PII_HASH_SALT',
    );
  }

  return {
    storePii,
    hashSalt,
  };
}
