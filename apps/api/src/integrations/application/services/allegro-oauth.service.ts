/**
 * Allegro OAuth Service
 *
 * Application service for Allegro OAuth flow operations. Handles OAuth
 * authorization URL generation, token exchange, connection validation,
 * and idempotent callback state management via Redis completed-state markers.
 *
 * @module apps/api/src/integrations/application/services
 * @implements {IAllegroOAuthService}
 */
import { Injectable, BadRequestException, InternalServerErrorException, Inject, NotFoundException } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { randomUUID, randomBytes } from 'crypto';
import { RedisClientType } from 'redis';
import { AllegroConnectionConfig, AllegroEnvironmentValues } from '@openlinker/integrations-allegro';
import { ConnectionService } from './connection.service';
import { Connection, ConnectionConfig } from '@openlinker/core/identifier-mapping';
import { INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN, IntegrationCredentialRepositoryPort } from '@openlinker/core/integrations';
import { IAllegroOAuthService } from '../interfaces/allegro-oauth.service.interface';
import type {
  AllegroOAuthAuthorizationResponse,
  AllegroOAuthTokenResponse,
  OAuthStateData,
  CompletedStateData,
} from '../interfaces/allegro-oauth.service.types';

const ALLEGRO_OAUTH_TIMEOUT_MS = 10_000;

@Injectable()
export class AllegroOAuthService implements IAllegroOAuthService {
  private readonly logger = new Logger(AllegroOAuthService.name);
  private readonly STATE_TTL_SECONDS = 600; // 10 minutes
  private readonly COMPLETED_STATE_TTL_SECONDS = 300; // 5 minutes — idempotency window

  constructor(
    private readonly connectionService: ConnectionService,
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    private readonly credentialRepository: IntegrationCredentialRepositoryPort,
  ) {}

  /**
   * Generate OAuth authorization URL
   *
   * Creates an OAuth authorization URL that the user should redirect to
   * for OAuth consent. Returns the URL and a state parameter for CSRF protection.
   * Stores state in Redis for validation during callback.
   */
  async generateAuthorizationUrl(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    environment: string = 'sandbox',
    state?: string,
    connectionName?: string,
    masterCatalogConnectionId?: string,
  ): Promise<AllegroOAuthAuthorizationResponse> {
    // Generate state if not provided
    const oauthState = state || randomBytes(32).toString('hex');

    // Store state in Redis for validation during callback
    // clientSecret is stored in state temporarily during OAuth flow
    const stateData: OAuthStateData = {
      clientId,
      clientSecret, // Used during OAuth flow, then stored in DB
      redirectUri,
      environment,
      connectionName,
      masterCatalogConnectionId,
    };
    const stateKey = `allegro:oauth:state:${oauthState}`;
    await this.redisClient.setEx(
      stateKey,
      this.STATE_TTL_SECONDS,
      JSON.stringify(stateData),
    );

    // Determine API base URL based on environment
    const apiBaseUrl = this.getApiBaseUrl(environment);

    // Build authorization URL
    // Allegro OAuth 2.0 authorization endpoint format:
    // https://allegro.pl.allegrosandbox.pl/auth/oauth/authorize?client_id={clientId}&response_type=code&redirect_uri={redirectUri}&state={state}
    const authorizationUrl = new URL('/auth/oauth/authorize', apiBaseUrl);
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('state', oauthState);

    this.logger.debug(
      `Generated OAuth authorization URL for environment: ${environment}, state: ${oauthState}`,
    );

    return {
      authorizationUrl: authorizationUrl.toString(),
      state: oauthState,
    };
  }

  /**
   * Validate OAuth state parameter
   *
   * Validates the state parameter from OAuth callback against stored state in Redis.
   * Returns state data if valid, null if invalid or expired.
   */
  async validateState(state: string): Promise<OAuthStateData | null> {
    const stateKey = `allegro:oauth:state:${state}`;
    const stored = await this.redisClient.get(stateKey);

    if (!stored) {
      this.logger.debug(`OAuth state not found or expired: ${state}`);
      return null;
    }

    try {
      const stateData = JSON.parse(stored) as OAuthStateData;

      // Delete state after validation (one-time use for security)
      await this.redisClient.del(stateKey);

      this.logger.debug(`OAuth state validated successfully: ${state}`);
      return stateData;
    } catch (error) {
      this.logger.error(`Failed to parse OAuth state data: ${(error as Error).message}`, error);
      await this.redisClient.del(stateKey); // Clean up invalid state
      return null;
    }
  }

  /**
   * Exchange authorization code for access token
   *
   * Exchanges the OAuth authorization code received from Allegro callback
   * for an access token and refresh token.
   *
   * Note: clientSecret should be retrieved from secure storage (connection config
   * or credentials store) rather than passed as a parameter. This method signature
   * is temporary until credentials storage is implemented.
   */
  async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    environment: string = 'sandbox',
  ): Promise<AllegroOAuthTokenResponse> {
    const apiBaseUrl = this.getApiBaseUrl(environment);

    // Build token endpoint URL
    const tokenUrl = new URL('/auth/oauth/token', apiBaseUrl);

    // Prepare token exchange request
    const tokenRequest = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    };

    // Create Basic Auth header (client_id:client_secret)
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    try {
      this.logger.debug(`Exchanging authorization code for token (environment: ${environment})`);

      const response = await this.fetchWithTimeout(
        tokenUrl.toString(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
          },
          body: new URLSearchParams(tokenRequest).toString(),
        },
        ALLEGRO_OAUTH_TIMEOUT_MS,
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Failed to exchange code for token: ${response.status} ${response.statusText} - ${errorText}`,
        );
        throw new BadRequestException(
          `Failed to exchange authorization code for token: ${response.statusText}`,
        );
      }

      const tokenData = (await response.json()) as AllegroOAuthTokenResponse;

      this.logger.debug(`Successfully exchanged code for token (token_type: ${tokenData.token_type})`);

      return tokenData;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const formatted = this.formatFetchError(error);
      this.logger.error(
        `Error exchanging code for token (environment: ${environment}): ${formatted}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Failed to exchange authorization code for token');
    }
  }

  /**
   * Validate connection configuration
   *
   * Validates that a connection's configuration is valid for Allegro.
   * Checks environment, API base URL format, and credentials structure.
   */
  async validateConnection(connectionId: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const connection = await this.connectionService.get(connectionId);

      // Check platform type
      if (connection.platformType !== 'allegro') {
        errors.push(`Connection is not an Allegro connection (platformType: ${connection.platformType})`);
        return { valid: false, errors };
      }

      // Validate config
      if (!connection.config) {
        errors.push('Connection is missing config');
        return { valid: false, errors };
      }

      const config = connection.config as unknown as AllegroConnectionConfig;

      // Validate environment
      if (!config.environment) {
        errors.push('Config is missing environment');
      } else if (!AllegroEnvironmentValues.includes(config.environment)) {
        errors.push(
          `Invalid environment: ${config.environment}. Must be one of: ${AllegroEnvironmentValues.join(', ')}`,
        );
      }

      // Validate apiBaseUrl if provided
      if (config.apiBaseUrl) {
        try {
          new URL(config.apiBaseUrl);
        } catch {
          errors.push(`Invalid apiBaseUrl format: ${config.apiBaseUrl}`);
        }
      }

      // Check credentialsRef exists
      if (!connection.credentialsRef) {
        errors.push('Connection is missing credentialsRef');
      }

      const valid = errors.length === 0;

      if (valid) {
        this.logger.debug(`Connection ${connectionId} validation passed`);
      } else {
        this.logger.warn(`Connection ${connectionId} validation failed: ${errors.join(', ')}`);
      }

      return { valid, errors };
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.logger.warn(`Connection not found for validation: ${connectionId}`);
        errors.push(`Connection not found: ${connectionId}`);
        return { valid: false, errors };
      }
      this.logger.error(`Error validating connection ${connectionId}: ${(error as Error).message}`, error);
      errors.push(`Failed to validate connection: ${(error as Error).message}`);
      return { valid: false, errors };
    }
  }

  /**
   * Store credentials and create connection
   *
   * Stores OAuth credentials in the database and creates a connection with
   * the appropriate configuration and credentials reference.
   *
   * @param tokenResponse - OAuth token response from Allegro
   * @param stateData - OAuth state data from Redis
   * @returns Created connection
   */
  async storeCredentialsAndCreateConnection(
    tokenResponse: AllegroOAuthTokenResponse,
    stateData: OAuthStateData,
  ): Promise<Connection> {
    this.logger.log(
      `Storing credentials and creating connection for Allegro (environment: ${stateData.environment}, connectionName: ${stateData.connectionName || 'N/A'})`,
    );

    // Generate credential reference
    // Format: allegro_{environment}_{timestamp}_{uuid}
    // Using UUID for random portion to avoid collisions
    const timestamp = Date.now();
    const uuid = randomUUID();
    const credentialRef = `allegro_${stateData.environment}_${timestamp}_${uuid}`;

    // Prepare credentials for storage
    // Include clientId and clientSecret for token refresh capability
    const credentials = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: tokenResponse.expires_in
        ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
        : undefined,
      // Store client credentials for token refresh
      clientId: stateData.clientId,
      clientSecret: stateData.clientSecret,
    };

    // Store credentials in database
    try {
      await this.credentialRepository.create({
        ref: credentialRef,
        platformType: 'allegro',
        credentialsJson: credentials as unknown as Record<string, unknown>,
        encrypted: false, // For MVP, credentials are stored unencrypted. Encryption can be added later.
      });
      this.logger.log(`Credentials stored in database: ${credentialRef}`);
    } catch (error) {
      this.logger.error(`Failed to store credentials: ${(error as Error).message}`, error);
      throw new InternalServerErrorException(
        `Failed to store credentials: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Prepare connection config
    const config: AllegroConnectionConfig = {
      environment: stateData.environment as 'sandbox' | 'production',
      ...(stateData.masterCatalogConnectionId
        ? { masterCatalogConnectionId: stateData.masterCatalogConnectionId }
        : {}),
    };

    // Create connection with database credentials reference
    const connection = await this.connectionService.create({
      platformType: 'allegro',
      name: stateData.connectionName || `Allegro ${stateData.environment} (${new Date().toISOString()})`,
      config: config as unknown as ConnectionConfig,
      credentialsRef: `db:${credentialRef}`, // Use db: prefix for database backend
      adapterKey: 'allegro.publicapi.v1',
    });

    this.logger.log(
      `Connection created successfully: ${connection.id} (name: ${connection.name}, credentialsRef: ${connection.credentialsRef})`,
    );

    return connection;
  }

  /**
   * Refresh access token using refresh token
   *
   * Exchanges a refresh token for a new access token and updates credentials
   * in the database. This method is used when the access token expires.
   *
   * @param refreshToken - OAuth refresh token
   * @param clientId - OAuth client ID
   * @param clientSecret - OAuth client secret
   * @param environment - Allegro environment (sandbox or production)
   * @returns New token response with access token and refresh token
   */
  async refreshToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
    environment: string = 'sandbox',
  ): Promise<AllegroOAuthTokenResponse> {
    const apiBaseUrl = this.getApiBaseUrl(environment);

    // Build token endpoint URL
    const tokenUrl = new URL('/auth/oauth/token', apiBaseUrl);

    // Prepare token refresh request
    const tokenRequest = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    // Create Basic Auth header (client_id:client_secret)
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    try {
      this.logger.debug(`Refreshing access token (environment: ${environment})`);

      const response = await this.fetchWithTimeout(
        tokenUrl.toString(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
          },
          body: new URLSearchParams(tokenRequest).toString(),
        },
        ALLEGRO_OAUTH_TIMEOUT_MS,
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Failed to refresh token: ${response.status} ${response.statusText} - ${errorText}`,
        );
        throw new BadRequestException(
          `Failed to refresh access token: ${response.statusText}. The refresh token may be invalid or expired.`,
        );
      }

      const tokenData = (await response.json()) as AllegroOAuthTokenResponse;

      this.logger.debug(`Successfully refreshed access token (token_type: ${tokenData.token_type})`);

      return tokenData;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const formatted = this.formatFetchError(error);
      this.logger.error(
        `Error refreshing token (environment: ${environment}): ${formatted}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Failed to refresh access token');
    }
  }

  /**
   * Persist a short-lived completed marker in Redis after a successful callback.
   * Allows the callback endpoint to respond idempotently if the same state is
   * replayed within the TTL window (e.g. browser back-button or duplicate request).
   */
  async markStateCompleted(
    state: string,
    connectionId: string,
    connectionName: string,
  ): Promise<void> {
    const key = `allegro:oauth:completed:${state}`;
    const value: CompletedStateData = { connectionId, connectionName };
    await this.redisClient.setEx(key, this.COMPLETED_STATE_TTL_SECONDS, JSON.stringify(value));
    this.logger.debug(`OAuth completed marker stored for state: ${state}`);
  }

  /**
   * Check whether a completed marker exists for the given state.
   * Does not consume (delete) the marker — safe to call multiple times.
   * Returns connection data if found within the TTL window, null otherwise.
   */
  async checkCompletedState(state: string): Promise<CompletedStateData | null> {
    const key = `allegro:oauth:completed:${state}`;
    const stored = await this.redisClient.get(key);

    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as CompletedStateData;
    } catch (error) {
      this.logger.error(`Failed to parse OAuth completed state data: ${(error as Error).message}`, error);
      // Self-heal: drop the poisoned marker so a subsequent write can succeed cleanly.
      await this.redisClient.del(key);
      return null;
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
   * Perform a fetch bounded by a timeout via AbortController.
   *
   * Without this, a hung Allegro endpoint pins the request until the OS-level
   * TCP timeout (~2 minutes). The AbortError surfaced on timeout is formatted
   * by {@link formatFetchError} with a dedicated phrasing.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Format a thrown value from `fetch()` into an operator-actionable string.
   *
   * For an undici network failure, `error.message` is the literal `"fetch failed"`;
   * the useful detail (`ECONNREFUSED`, `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`) lives
   * on `error.cause.code` / `error.cause.message`. DNS fan-out / happy-eyeballs
   * surface an AggregateError-shaped cause whose codes live on `cause.errors[]`.
   * AbortErrors raised by {@link fetchWithTimeout} get a dedicated phrasing.
   */
  private formatFetchError(error: unknown): string {
    if (!(error instanceof Error)) {
      return `non-error thrown: ${String(error)}`;
    }
    if (error.name === 'AbortError') {
      return `request aborted after ${ALLEGRO_OAUTH_TIMEOUT_MS}ms`;
    }
    const baseMessage = error.message || 'unknown error';
    const cause = (error as Error & { cause?: unknown }).cause;

    if (cause && typeof cause === 'object') {
      const errorsProp = (cause as { errors?: unknown }).errors;
      if (Array.isArray(errorsProp)) {
        const codes = errorsProp
          .map((e) =>
            e && typeof e === 'object' && 'code' in e
              ? (e as { code?: unknown }).code
              : undefined,
          )
          .filter((c): c is string => typeof c === 'string');
        const codeSummary = codes.length > 0 ? codes.join(', ') : 'unknown';
        return `${baseMessage} (cause: aggregate — ${codeSummary})`;
      }

      const codeProp = (cause as { code?: unknown }).code;
      const messageProp = (cause as { message?: unknown }).message;
      const causeCode = typeof codeProp === 'string' ? codeProp : 'unknown';
      const causeMessage = typeof messageProp === 'string' ? messageProp : 'n/a';
      return `${baseMessage} (cause: ${causeCode} — ${causeMessage})`;
    }

    return `${baseMessage} (cause: unknown — n/a)`;
  }
}

