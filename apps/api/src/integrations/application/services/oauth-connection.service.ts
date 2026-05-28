/**
 * OAuth Connection Service
 *
 * Host-side, platform-neutral orchestration of the OAuth2 authorization-code
 * flow (#859). Owns everything neutral about the flow:
 *   - Redis OAuth-state lifecycle (mint, validate-and-consume) + CSRF state.
 *   - Idempotent-replay completed markers.
 *   - Credential-blob persistence and connection create / re-auth-in-place
 *     (#819), keyed on the neutral `oauthAccountId` same-account guard (#820).
 *
 * The three provider-specific steps — authorize-URL construction, code→token
 * exchange, and account-identity verification — are delegated to an
 * `OAuthCompletionPort` resolved by `adapterKey` through
 * `OAuthCompletionRegistryService`. The host therefore imports no platform
 * (Allegro etc.) OAuth knowledge.
 *
 * @module apps/api/src/integrations/application/services
 * @implements {IOAuthConnectionService}
 */
import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { randomUUID, randomBytes } from 'crypto';
import { RedisClientType } from 'redis';
import type { Connection, ConnectionConfig } from '@openlinker/core/identifier-mapping';
import {
  CREDENTIALS_SERVICE_TOKEN,
  ICredentialsService,
  INTEGRATIONS_OAUTH_COMPLETION_REGISTRY_TOKEN,
  OAuthCompletionRegistryService,
  OAuthCodeExchangeException,
} from '@openlinker/core/integrations';
import type {
  OAuthCompletionPort,
  OAuthCredentialBlob,
  OAuthAccountIdentity,
} from '@openlinker/core/integrations';
import { ConnectionService } from './connection.service';
import type { IOAuthConnectionService } from '../interfaces/oauth-connection.service.interface';
import type {
  OAuthAuthorizationResponse,
  GenerateAuthorizationUrlInput,
  OAuthStateData,
  CompletedStateData,
} from '../interfaces/oauth-connection.service.types';

@Injectable()
export class OAuthConnectionService implements IOAuthConnectionService {
  private readonly logger = new Logger(OAuthConnectionService.name);
  private readonly STATE_TTL_SECONDS = 600; // 10 minutes
  private readonly COMPLETED_STATE_TTL_SECONDS = 300; // 5 minutes — idempotency window
  private readonly STATE_KEY_PREFIX = 'oauth:state:';
  private readonly COMPLETED_KEY_PREFIX = 'oauth:completed:';

  constructor(
    private readonly connectionService: ConnectionService,
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType,
    @Inject(CREDENTIALS_SERVICE_TOKEN)
    private readonly credentials: ICredentialsService,
    @Inject(INTEGRATIONS_OAUTH_COMPLETION_REGISTRY_TOKEN)
    private readonly oauthCompletionRegistry: OAuthCompletionRegistryService
  ) {}

  async generateAuthorizationUrl(
    input: GenerateAuthorizationUrlInput
  ): Promise<OAuthAuthorizationResponse> {
    const adapter = this.resolveAdapter(input.adapterKey);
    const state = input.state || randomBytes(32).toString('hex');

    const stateData: OAuthStateData = {
      adapterKey: input.adapterKey,
      platformType: input.platformType,
      clientId: input.clientId,
      clientSecret: input.clientSecret, // held transiently; folded into the persisted blob
      redirectUri: input.redirectUri,
      connectionName: input.connectionName,
      connectionId: input.connectionId,
      initialConfig: input.initialConfig,
    };
    await this.redisClient.setEx(
      `${this.STATE_KEY_PREFIX}${state}`,
      this.STATE_TTL_SECONDS,
      JSON.stringify(stateData)
    );

    const authorizationUrl = adapter.buildAuthorizationUrl({
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      state,
      config: input.initialConfig,
    });

    this.logger.debug(
      `Generated OAuth authorization URL for adapterKey: ${input.adapterKey}, state: ${state}`
    );

    return { authorizationUrl, state };
  }

  async validateState(state: string): Promise<OAuthStateData | null> {
    const stateKey = `${this.STATE_KEY_PREFIX}${state}`;
    const stored = await this.redisClient.get(stateKey);

    if (!stored) {
      this.logger.debug(`OAuth state not found or expired: ${state}`);
      return null;
    }

    try {
      const stateData = JSON.parse(stored) as OAuthStateData;
      // Delete state after validation (one-time use for security).
      await this.redisClient.del(stateKey);
      this.logger.debug(`OAuth state validated successfully: ${state}`);
      return stateData;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to parse OAuth state data: ${message}`, stack);
      await this.redisClient.del(stateKey); // Clean up invalid state
      return null;
    }
  }

  async completeAuthorization(code: string, stateData: OAuthStateData): Promise<Connection> {
    const adapter = this.resolveAdapter(stateData.adapterKey);

    // 1. Exchange the code for the normalized credential blob. A provider-side
    //    rejection (OAuthCodeExchangeException) is a 400; anything else
    //    (network/timeout) is a 500 — preserving the pre-relocation split.
    let credentialBlob: OAuthCredentialBlob;
    try {
      credentialBlob = await adapter.exchangeCode({
        code,
        clientId: stateData.clientId,
        clientSecret: stateData.clientSecret,
        redirectUri: stateData.redirectUri,
        config: stateData.initialConfig,
      });
    } catch (error) {
      if (error instanceof OAuthCodeExchangeException) {
        throw new BadRequestException(error.message);
      }
      this.logger.error(
        `Error exchanging code for token (adapterKey: ${stateData.adapterKey}): ${(error as Error).message}`,
        error instanceof Error ? error.stack : undefined
      );
      throw new InternalServerErrorException('Failed to exchange authorization code for token');
    }

    // 2. Verify the account identity up front (shared by create + re-auth), so
    //    a connection is never anchored to an unverified account (#820). Any
    //    failure is fatal — surfaces as 500, state already consumed → operator
    //    retries the whole flow.
    let identity: OAuthAccountIdentity | undefined;
    try {
      identity = await adapter.fetchAccountIdentity({
        credentials: credentialBlob,
        config: stateData.initialConfig,
      });
    } catch (error) {
      this.logger.error(
        `Failed to verify account identity: ${(error as Error).message}`,
        error instanceof Error ? error.stack : undefined
      );
      throw new InternalServerErrorException('Failed to verify account identity');
    }

    // 3. Re-auth-in-place (#819) when state carries an existing connectionId;
    //    otherwise mint a new connection.
    if (stateData.connectionId) {
      return this.reauthenticateExistingConnection(
        stateData.connectionId,
        credentialBlob,
        identity,
        stateData
      );
    }
    return this.createConnection(credentialBlob, identity, stateData);
  }

  async markStateCompleted(
    state: string,
    connectionId: string,
    connectionName: string
  ): Promise<void> {
    const key = `${this.COMPLETED_KEY_PREFIX}${state}`;
    const value: CompletedStateData = { connectionId, connectionName };
    await this.redisClient.setEx(key, this.COMPLETED_STATE_TTL_SECONDS, JSON.stringify(value));
    this.logger.debug(`OAuth completed marker stored for state: ${state}`);
  }

  async checkCompletedState(state: string): Promise<CompletedStateData | null> {
    const key = `${this.COMPLETED_KEY_PREFIX}${state}`;
    const stored = await this.redisClient.get(key);

    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as CompletedStateData;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to parse OAuth completed state data: ${message}`, stack);
      // Self-heal: drop the poisoned marker so a subsequent write can succeed cleanly.
      await this.redisClient.del(key);
      return null;
    }
  }

  /**
   * Resolve the per-platform OAuth-completion adapter. A missing registration
   * is a server-side wiring fault (the platform plugin isn't loaded), so it
   * surfaces as 500.
   */
  private resolveAdapter(adapterKey: string): OAuthCompletionPort {
    const adapter = this.oauthCompletionRegistry.get(adapterKey);
    if (!adapter) {
      this.logger.error(`No OAuth-completion adapter registered for adapterKey: ${adapterKey}`);
      throw new InternalServerErrorException(
        `No OAuth-completion adapter registered for ${adapterKey}`
      );
    }
    return adapter;
  }

  private async createConnection(
    credentialBlob: OAuthCredentialBlob,
    identity: OAuthAccountIdentity | undefined,
    stateData: OAuthStateData
  ): Promise<Connection> {
    this.logger.log(
      `Storing credentials and creating connection (platformType: ${stateData.platformType}, connectionName: ${stateData.connectionName ?? 'N/A'})`
    );

    // Neutral credential reference: oauth_{adapterKey}_{timestamp}_{uuid}.
    // The human-readable prefix is cosmetic — credentials resolve by the exact
    // `db:`-prefixed ref, so the rename only affects newly minted refs.
    const credentialRef = `oauth_${stateData.adapterKey}_${Date.now()}_${randomUUID()}`;
    try {
      await this.credentials.create({
        ref: credentialRef,
        platformType: stateData.platformType,
        credentialsJson: credentialBlob,
      });
      this.logger.log(`Credentials stored in database: ${credentialRef}`);
    } catch (error) {
      this.logger.error(`Failed to store credentials: ${(error as Error).message}`, error);
      throw new InternalServerErrorException(
        `Failed to store credentials: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const config: Record<string, unknown> = {
      ...(stateData.initialConfig ?? {}),
      ...(identity ? { oauthAccountId: identity.accountId } : {}),
    };

    const connection = await this.connectionService.create({
      platformType: stateData.platformType,
      name: stateData.connectionName || `${stateData.platformType} (${new Date().toISOString()})`,
      config: config as ConnectionConfig,
      credentialsRef: `db:${credentialRef}`, // db: prefix selects the database credentials backend
      adapterKey: stateData.adapterKey,
    });

    this.logger.log(
      `Connection created successfully: ${connection.id} (name: ${connection.name}, credentialsRef: ${connection.credentialsRef})`
    );

    return connection;
  }

  /**
   * Re-authenticate an existing connection in place (#819) — rotate stored
   * credentials and flip status back to `active`, preserving the connection id
   * and every connection-scoped identifier mapping. The same-account guard
   * (#820) rejects a token for a different account BEFORE rotating.
   */
  private async reauthenticateExistingConnection(
    connectionId: string,
    credentialBlob: OAuthCredentialBlob,
    identity: OAuthAccountIdentity | undefined,
    stateData: OAuthStateData
  ): Promise<Connection> {
    this.logger.log(`Re-authenticating existing connection in place: ${connectionId}`);

    const existing = await this.connectionService.get(connectionId);
    if (existing.platformType !== stateData.platformType) {
      throw new BadRequestException(
        `Connection ${connectionId} is not a ${stateData.platformType} connection (platformType: ${existing.platformType})`
      );
    }

    // Same-account guard (#820): read the neutral `oauthAccountId`, falling
    // back to the #820-era `sellerId` for connections created before this
    // relocation (backfilled below). Reject BEFORE rotating credentials when
    // the stored account differs.
    const config = existing.config as { oauthAccountId?: string; sellerId?: string } | undefined;
    const storedAccountId = config?.oauthAccountId ?? config?.sellerId;
    const incomingAccountId = identity?.accountId;
    if (storedAccountId && incomingAccountId && storedAccountId !== incomingAccountId) {
      this.logger.warn(
        `OAuth re-auth account mismatch on connection ${connectionId} (name: ${existing.name}): ` +
          `stored=${storedAccountId}, incoming=${incomingAccountId} (label: ${identity?.label ?? 'n/a'})`
      );
      throw new BadRequestException({
        message:
          `This authorization is for a different account (${identity?.label ?? incomingAccountId}) ` +
          `than connection "${existing.name}" is bound to (account ${storedAccountId}). ` +
          `Re-authenticate with the original account, or create a new connection.`,
        code: 'OAUTH_ACCOUNT_MISMATCH',
      });
    }

    await this.connectionService.updateCredentials(connectionId, credentialBlob);

    const mergedConfig = {
      ...((existing.config as Record<string, unknown> | undefined) ?? {}),
      ...(incomingAccountId ? { oauthAccountId: incomingAccountId } : {}),
    };
    const connection = await this.connectionService.update(connectionId, {
      status: 'active',
      config: mergedConfig as ConnectionConfig,
    });

    if (!storedAccountId && incomingAccountId) {
      this.logger.log(
        `Backfilled oauthAccountId=${incomingAccountId} on connection ${connectionId} during re-auth`
      );
    }

    this.logger.log(
      `Connection re-authenticated successfully: ${connection.id} (name: ${connection.name}, status: ${connection.status})`
    );

    return connection;
  }
}
