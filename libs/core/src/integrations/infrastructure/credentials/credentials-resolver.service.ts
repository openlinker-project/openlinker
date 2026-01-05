/**
 * Credentials Resolver Service
 *
 * MVP implementation of CredentialsResolverPort using environment variables.
 * For development and testing, credentials are read from environment variables
 * using the pattern: CREDENTIALS_{credentialsRef}.
 *
 * Future implementations can support:
 * - Encrypted local files
 * - HashiCorp Vault
 * - AWS Secrets Manager
 * - GCP Secret Manager
 *
 * @module libs/core/src/integrations/infrastructure/credentials
 * @implements {CredentialsResolverPort}
 */
import { Injectable } from '@nestjs/common';
import { CredentialsResolverPort } from '@openlinker/core/integrations/domain/ports/credentials-resolver.port';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class CredentialsResolverService implements CredentialsResolverPort {
  private readonly logger = new Logger(CredentialsResolverService.name);

  get<T = unknown>(credentialsRef: string): Promise<T> {
    this.logger.debug(`Resolving credentials for reference: ${credentialsRef}`);

    // MVP: Read from environment variable
    // Pattern: CREDENTIALS_{credentialsRef}
    // Example: credentialsRef='prestashop_123' → env var 'CREDENTIALS_prestashop_123'
    const envKey = `CREDENTIALS_${credentialsRef.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
    const credentialsValue = process.env[envKey];

    if (!credentialsValue) {
      throw new Error(
        `Credentials not found for reference: ${credentialsRef} (looked for env var: ${envKey}). ` +
          'Set the environment variable with JSON-encoded credentials or a plain string (for simple cases).',
      );
    }

    // Try to parse as JSON first
    try {
      const credentials = JSON.parse(credentialsValue) as T;
      this.logger.debug(`Credentials resolved successfully for reference: ${credentialsRef}`);
      return Promise.resolve(credentials);
    } catch (jsonError) {
      // If JSON parsing fails, check if it's a plain string
      // This allows simple credentials (like PrestaShop API key) to be set as plain strings
      // If the value doesn't look like JSON (doesn't start with { or [), treat it as a plain string
      if (!credentialsValue.trim().startsWith('{') && !credentialsValue.trim().startsWith('[')) {
        // For PrestaShop, if it's a plain string, auto-wrap it as {webserviceApiKey: value}
        // This provides backward compatibility and simpler UX for single-value credentials
        this.logger.debug(
          `Credentials value is not JSON, treating as plain string and auto-wrapping for PrestaShop compatibility`,
        );
        const wrappedCredentials = { webserviceApiKey: credentialsValue } as T;
        this.logger.debug(`Credentials resolved successfully for reference: ${credentialsRef} (auto-wrapped)`);
        return Promise.resolve(wrappedCredentials);
      }

      // If it looks like JSON but failed to parse, throw the original error
      throw new Error(
        `Failed to parse credentials for reference: ${credentialsRef}. ` +
          `Invalid JSON in environment variable ${envKey}: ${(jsonError as Error).message}`,
      );
    }
  }
}

