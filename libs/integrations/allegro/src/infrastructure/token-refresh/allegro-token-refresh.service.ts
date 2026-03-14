/**
 * Allegro Token Refresh Service
 *
 * Service for refreshing expired Allegro OAuth access tokens. Handles token
 * refresh flow, updates credentials in the database, and provides thread-safe
 * refresh operations using distributed locks.
 *
 * @module libs/integrations/allegro/src/infrastructure/token-refresh
 */
import { Injectable, Inject, Optional } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { Connection } from '@openlinker/core/identifier-mapping';
import {
  CredentialsResolverPort,
  IntegrationCredentialRepositoryPort,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
} from '@openlinker/core/integrations';
import { AllegroConnectionConfig } from '../../domain/types/allegro-config.types';
import { AllegroCredentials } from '../../domain/types/allegro-credentials.types';
import { AllegroConfigException } from '../../domain/exceptions/allegro-config.exception';
import { AllegroAuthenticationException } from '../../domain/exceptions/allegro-authentication.exception';
import { RedisClientType } from 'redis';

/**
 * Token refresh response
 */
export interface TokenRefreshResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date | string;
}

/**
 * Extended Allegro credentials including OAuth client credentials
 */
interface AllegroCredentialsWithClient {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date | string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Allegro Token Refresh Service
 *
 * Handles automatic token refresh for expired Allegro access tokens.
 */
@Injectable()
export class AllegroTokenRefreshService {
  private readonly logger = new Logger(AllegroTokenRefreshService.name);
  private readonly LOCK_TTL_SECONDS = 30; // Lock expires after 30 seconds
  private readonly LOCK_KEY_PREFIX = 'allegro:token-refresh:lock:';

  constructor(
    @Optional()
    @Inject('REDIS_CLIENT')
    private readonly redisClient?: RedisClientType,
    @Optional()
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    private readonly credentialRepository?: IntegrationCredentialRepositoryPort,
  ) {}

  /**
   * Refresh access token for a connection
   *
   * Attempts to refresh the access token using the refresh token stored in
   * credentials. Uses distributed locking to prevent concurrent refresh attempts.
   *
   * @param connection - Connection entity with credentialsRef
   * @param credentialsResolver - Credentials resolver to get current credentials
   * @returns New access token
   * @throws Error if refresh fails (invalid refresh token, missing client credentials, etc.)
   */
  async refreshToken(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<TokenRefreshResponse> {
    const lockKey = `${this.LOCK_KEY_PREFIX}${connection.id}`;

    // Acquire distributed lock to prevent concurrent refresh attempts
    const lockAcquired = await this.acquireLock(lockKey);
    if (!lockAcquired) {
      // Another process is refreshing, wait a bit and retry getting credentials
      this.logger.debug(
        `Token refresh already in progress for connection ${connection.id}, waiting...`,
      );
      await this.sleep(1000); // Wait 1 second
      // Try to get updated credentials (another process may have refreshed them)
      const updatedCredentials = await credentialsResolver.get<AllegroCredentials>(connection.credentialsRef);
      return {
        accessToken: updatedCredentials.accessToken,
        refreshToken: updatedCredentials.refreshToken,
        expiresAt: updatedCredentials.expiresAt,
      };
    }

    try {
      // Get current credentials
      const credentials = await credentialsResolver.get<AllegroCredentialsWithClient>(
        connection.credentialsRef,
      );

      // Validate refresh token exists
      if (!credentials.refreshToken) {
        throw new AllegroAuthenticationException(
          `No refresh token available for connection ${connection.id}. Re-authentication required. ` +
            'Please re-authenticate this connection through the OAuth flow.',
          401,
        );
      }

      // Validate client credentials exist
      // Note: Connections created before token refresh was implemented may not have clientId/clientSecret.
      // These connections need to be re-authenticated to store the client credentials.
      if (!credentials.clientId || !credentials.clientSecret) {
        throw new AllegroAuthenticationException(
          `Missing OAuth client credentials (clientId/clientSecret) for connection ${connection.id}. ` +
            'This connection was created before token refresh support was added. ' +
            'Please re-authenticate this connection through the OAuth flow to enable automatic token refresh.',
          401,
        );
      }

      // Get connection config
      const config = connection.config as unknown as AllegroConnectionConfig;
      if (!config) {
        throw new AllegroConfigException(`Missing connection config for connection ${connection.id}`);
      }

      const environment = config.environment || 'sandbox';
      const apiBaseUrl = this.getApiBaseUrl(environment);

      // Call Allegro token refresh endpoint
      const tokenResponse = await this.callRefreshEndpoint(
        credentials.refreshToken,
        credentials.clientId,
        credentials.clientSecret,
        apiBaseUrl,
      );

      // Prepare updated credentials
      const updatedCredentials: AllegroCredentialsWithClient = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token || credentials.refreshToken, // Use new refresh token if provided, otherwise keep old one
        expiresAt: tokenResponse.expires_in
          ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
          : undefined,
        clientId: credentials.clientId, // Preserve client credentials
        clientSecret: credentials.clientSecret,
      };

      // Update credentials in database
      if (this.credentialRepository && connection.credentialsRef) {
        const credentialRef = connection.credentialsRef.startsWith('db:')
          ? connection.credentialsRef.substring(3)
          : connection.credentialsRef;

        await this.credentialRepository.update(credentialRef, {
          credentialsJson: updatedCredentials as unknown as Record<string, unknown>,
        });

        this.logger.log(
          `Successfully refreshed and updated access token for connection ${connection.id}`,
        );
      } else {
        this.logger.warn(
          `Token refreshed but cannot update database (credentialRepository not available). ` +
            `Connection ${connection.id} will need to be re-authenticated.`,
        );
      }

      return {
        accessToken: updatedCredentials.accessToken,
        refreshToken: updatedCredentials.refreshToken,
        expiresAt: updatedCredentials.expiresAt,
      };
    } finally {
      // Release lock
      await this.releaseLock(lockKey);
    }
  }

  /**
   * Call Allegro token refresh endpoint
   *
   * @param refreshToken - OAuth refresh token
   * @param clientId - OAuth client ID
   * @param clientSecret - OAuth client secret
   * @param apiBaseUrl - Allegro API base URL
   * @returns Token response from Allegro
   */
  private async callRefreshEndpoint(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
    apiBaseUrl: string,
  ): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; token_type: string }> {
    const tokenUrl = new URL('/auth/oauth/token', apiBaseUrl);

    // Prepare token refresh request
    const tokenRequest = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    // Create Basic Auth header (client_id:client_secret)
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    this.logger.debug(`Refreshing access token via ${tokenUrl.toString()}`);

    const response = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams(tokenRequest).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `Failed to refresh token: ${response.status} ${response.statusText} - ${errorText}`,
      );
      throw new Error(
        `Failed to refresh access token: ${response.statusText}. ` +
          `The refresh token may be invalid or expired. Response: ${errorText}`,
      );
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
    };

    this.logger.debug(`Successfully refreshed access token (token_type: ${tokenData.token_type})`);

    return tokenData;
  }

  /**
   * Acquire distributed lock for token refresh
   *
   * Uses Redis SET NX EX to atomically acquire a lock.
   *
   * @param lockKey - Lock key
   * @returns True if lock acquired, false if already locked
   */
  private async acquireLock(lockKey: string): Promise<boolean> {
    if (!this.redisClient) {
      // No Redis available - proceed without locking (not ideal but allows operation)
      this.logger.warn('Redis client not available, proceeding without distributed lock');
      return true;
    }

    try {
      // SET key value NX EX seconds - sets key only if not exists, with expiration
      const result = await this.redisClient.set(lockKey, '1', {
        NX: true, // Only set if not exists
        EX: this.LOCK_TTL_SECONDS, // Expire after TTL
      });

      return result === 'OK';
    } catch (error) {
      this.logger.error(`Failed to acquire lock ${lockKey}: ${(error as Error).message}`, error);
      // On error, proceed without lock (better than failing completely)
      return true;
    }
  }

  /**
   * Release distributed lock
   *
   * @param lockKey - Lock key
   */
  private async releaseLock(lockKey: string): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    try {
      await this.redisClient.del(lockKey);
    } catch (error) {
      this.logger.error(`Failed to release lock ${lockKey}: ${(error as Error).message}`, error);
      // Non-critical error, continue
    }
  }

  /**
   * Get API base URL for environment
   */
  private getApiBaseUrl(environment: string): string {
    switch (environment) {
      case 'sandbox':
        return 'https://allegro.pl.allegrosandbox.pl';
      case 'production':
        return 'https://allegro.pl';
      default:
        this.logger.warn(`Unknown environment: ${environment}, defaulting to sandbox`);
        return 'https://allegro.pl.allegrosandbox.pl';
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
