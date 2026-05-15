/**
 * Credentials Resolver Service
 *
 * Implementation of CredentialsResolverPort supporting multiple backends:
 * - Database storage: `db:{ref}` format (e.g., `db:allegro_123`)
 * - Environment variables: plain credentialsRef (e.g., `prestashop_123`)
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
import { Injectable, Inject, Optional } from '@nestjs/common';
import type { CredentialsResolverPort } from '../../domain/ports/credentials-resolver.port';
import { Logger } from '@openlinker/shared/logging';
import { INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN } from '../../integrations.tokens';
import { IntegrationCredentialRepositoryPort } from '../../domain/ports/integration-credential-repository.port';

@Injectable()
export class CredentialsResolverService implements CredentialsResolverPort {
  private readonly logger = new Logger(CredentialsResolverService.name);

  constructor(
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    @Optional()
    private readonly credentialRepository?: IntegrationCredentialRepositoryPort
  ) {}

  async get<T = unknown>(credentialsRef: string): Promise<T> {
    this.logger.debug(`Resolving credentials for reference: ${credentialsRef}`);

    // Check if credentialsRef uses database backend format: db:{ref}
    if (credentialsRef.startsWith('db:')) {
      return this.getFromDatabase<T>(credentialsRef);
    }

    // Fall back to environment variable backend (MVP/dev)
    return this.getFromEnvironment<T>(credentialsRef);
  }

  /**
   * Get credentials from database
   *
   * Extracts the ref from `db:{ref}` format and queries the credential repository.
   */
  private async getFromDatabase<T = unknown>(credentialsRef: string): Promise<T> {
    if (!this.credentialRepository) {
      throw new Error(
        `Database credential backend not available. Cannot resolve: ${credentialsRef}. ` +
          'Ensure IntegrationCredentialRepository is registered in IntegrationsModule.'
      );
    }

    // Extract ref from 'db:{ref}' format
    const ref = credentialsRef.substring(3); // Remove 'db:' prefix
    if (!ref) {
      throw new Error(
        `Invalid database credentials reference format: ${credentialsRef}. Expected format: db:{ref}`
      );
    }

    try {
      const credential = await this.credentialRepository.getByRef(ref);
      this.logger.debug(`Credentials resolved from database for reference: ${credentialsRef}`);
      return credential.credentialsJson as T;
    } catch (error) {
      this.logger.error(`Failed to resolve credentials from database: ${credentialsRef}`, error);
      throw new Error(
        `Credentials not found in database for reference: ${credentialsRef} (ref: ${ref}). ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get credentials from environment variable
   *
   * Dev/test only. Fail-closed under NODE_ENV=production so a deploy that
   * accidentally relies on plaintext env credentials is caught at boot (#709).
   */
  private async getFromEnvironment<T = unknown>(credentialsRef: string): Promise<T> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Plaintext env-var credentials backend is disabled in production. ` +
          `Reference: ${credentialsRef}. Store credentials encrypted via 'db:{ref}'.`
      );
    }

    // Pattern: CREDENTIALS_{credentialsRef}
    // Example: credentialsRef='prestashop_123' → env var 'CREDENTIALS_prestashop_123'
    const envKey = `CREDENTIALS_${credentialsRef.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
    const credentialsValue = process.env[envKey];

    if (!credentialsValue) {
      throw new Error(
        `Credentials not found for reference: ${credentialsRef} (looked for env var: ${envKey}). ` +
          'Set the environment variable with JSON-encoded credentials or a plain string (for simple cases). ' +
          'For database storage, use format: db:{ref}'
      );
    }

    // Try to parse as JSON first
    try {
      const credentials = JSON.parse(credentialsValue) as T;
      this.logger.debug(`Credentials resolved from environment for reference: ${credentialsRef}`);
      return Promise.resolve(credentials);
    } catch (jsonError) {
      // If JSON parsing fails, check if it's a plain string
      // This allows simple credentials (like PrestaShop API key) to be set as plain strings
      // If the value doesn't look like JSON (doesn't start with { or [), treat it as a plain string
      if (!credentialsValue.trim().startsWith('{') && !credentialsValue.trim().startsWith('[')) {
        // For PrestaShop, if it's a plain string, auto-wrap it as {webserviceApiKey: value}
        // This provides backward compatibility and simpler UX for single-value credentials
        this.logger.debug(
          `Credentials value is not JSON, treating as plain string and auto-wrapping for PrestaShop compatibility`
        );
        const wrappedCredentials = { webserviceApiKey: credentialsValue } as T;
        this.logger.debug(
          `Credentials resolved successfully for reference: ${credentialsRef} (auto-wrapped)`
        );
        return Promise.resolve(wrappedCredentials);
      }

      // If it looks like JSON but failed to parse, throw the original error
      throw new Error(
        `Failed to parse credentials for reference: ${credentialsRef}. ` +
          `Invalid JSON in environment variable ${envKey}: ${(jsonError as Error).message}`
      );
    }
  }
}
