/**
 * Credentials-backed Webhook Secret Adapter
 *
 * Production implementation of WebhookSecretProviderPort backed by the
 * encrypted integration_credentials table. Per-connection secrets are stored
 * with ref = `webhook-secret:<connectionId>`. Encryption-at-rest is handled
 * by the repository layer (#709) — this adapter only sees plaintext domain
 * entities.
 *
 * Env-variable-based secrets (legacy stub behavior) are
 * supported as a deprecated read-through fallback for one release — callers
 * migrating from stub wiring can rotate secrets into the DB at their own pace.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @implements {WebhookSecretProviderPort}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared';
import type { WebhookSecretProviderPort } from '../../domain/ports/webhook-secret-provider.port';
import { webhookSecretRef } from '../../domain/ports/webhook-secret-provider.port';
import { IntegrationCredentialRepositoryPort } from '../../domain/ports/integration-credential-repository.port';
import { CredentialNotFoundException } from '../../domain/exceptions/credential-not-found.exception';
import { INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN } from '../../integrations.tokens';

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 256;

interface CacheEntry {
  secret: string;
  expiresAt: number;
}

@Injectable()
export class CredentialsWebhookSecretAdapter implements WebhookSecretProviderPort {
  private readonly logger = new Logger(CredentialsWebhookSecretAdapter.name);
  /** FIFO eviction cache — oldest entry removed when capacity is reached. */
  private readonly cache = new Map<string, CacheEntry>();
  /** Tracks which env-fallback keys have already emitted a deprecation warning. */
  private readonly warnedEnvKeys = new Set<string>();

  constructor(
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    private readonly credentialRepository: IntegrationCredentialRepositoryPort,
    private readonly configService: ConfigService
  ) {}

  async getSecret(provider: string, connectionId: string): Promise<string> {
    const cacheKey = `${provider}:${connectionId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.secret;
    }

    const dbSecret = await this.tryLoadFromDb(connectionId);
    if (dbSecret !== null) {
      this.setCache(cacheKey, dbSecret);
      return dbSecret;
    }

    const envSecret = this.tryLoadFromEnv(provider, connectionId, cacheKey);
    if (envSecret !== null) {
      this.setCache(cacheKey, envSecret);
      return envSecret;
    }

    throw new Error(
      `Webhook secret not found for provider=${provider} connectionId=${connectionId}`
    );
  }

  invalidate(provider: string, connectionId: string): void {
    this.cache.delete(`${provider}:${connectionId}`);
  }

  private async tryLoadFromDb(connectionId: string): Promise<string | null> {
    try {
      const credential = await this.credentialRepository.getByRef(webhookSecretRef(connectionId));
      const webhookSecret = credential.credentialsJson?.webhookSecret;
      if (typeof webhookSecret !== 'string') {
        this.logger.error(
          `Webhook secret credential ${credential.ref} is missing a webhookSecret field`
        );
        return null;
      }
      return webhookSecret;
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        return null;
      }
      throw error;
    }
  }

  private tryLoadFromEnv(provider: string, connectionId: string, cacheKey: string): string | null {
    const connectionKey = `OPENLINKER_WEBHOOK_SECRET__${provider.toUpperCase()}__${connectionId.toUpperCase()}`;
    const providerKey = `OPENLINKER_WEBHOOK_SECRET__${provider.toUpperCase()}`;
    const value =
      this.configService.get<string>(connectionKey) ??
      this.configService.get<string>(providerKey) ??
      null;

    if (value !== null && !this.warnedEnvKeys.has(cacheKey)) {
      this.warnedEnvKeys.add(cacheKey);
      this.logger.warn(
        `Webhook secret for ${provider}:${connectionId} resolved from env var. ` +
          `This fallback is deprecated — rotate the secret via the API to persist it encrypted.`
      );
    }

    return value;
  }

  private setCache(key: string, secret: string): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const first = this.cache.keys().next();
      if (!first.done) this.cache.delete(first.value);
    }
    this.cache.set(key, { secret, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}
