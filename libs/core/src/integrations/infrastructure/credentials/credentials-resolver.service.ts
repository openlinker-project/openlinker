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
    const credentialsJson = process.env[envKey];

    if (!credentialsJson) {
      throw new Error(
        `Credentials not found for reference: ${credentialsRef} (looked for env var: ${envKey}). ` +
          'Set the environment variable with JSON-encoded credentials.',
      );
    }

    try {
      const credentials = JSON.parse(credentialsJson) as T;
      this.logger.debug(`Credentials resolved successfully for reference: ${credentialsRef}`);
      return Promise.resolve(credentials);
    } catch (error) {
      throw new Error(
        `Failed to parse credentials for reference: ${credentialsRef}. ` +
          `Invalid JSON in environment variable ${envKey}: ${(error as Error).message}`,
      );
    }
  }
}

