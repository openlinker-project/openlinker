/**
 * Credentials-backed AI Provider Adapter
 *
 * Per-provider implementation of `AiProviderCredentialsPort`. Each provider
 * has its own credential slot (`ref = ai-provider:{provider}` in the
 * encrypted `integration_credentials` table) and its own 60 s in-process
 * cache. Resolution priority per provider: DB → env → throw.
 *
 * Encryption-at-rest is handled by the repository layer (#709) — this adapter
 * only sees plaintext domain entities.
 *
 * The adapter is independent of which provider is currently *active* — that
 * resolution lives in `AiProviderActiveSettingsService`. This split lets
 * the `MultiProviderAiCompletionAdapter` route to the right Vercel adapter
 * (each pinned to its provider) and lets each Vercel adapter call
 * `getApiKey(this.provider)` without knowing about the active selection.
 *
 * Env reads go through `ConfigService.get<string>(...)` exclusively — never
 * `process.env` — to match the webhook-secret precedent and keep tests
 * easy to reason about.
 *
 * @module libs/core/src/ai/infrastructure/adapters
 * @implements {AiProviderCredentialsPort}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared';
import {
  ICredentialsService,
  CREDENTIALS_SERVICE_TOKEN,
  CredentialNotFoundException,
} from '@openlinker/core/integrations';
import type { AiProviderCredentialsPort } from '../../domain/ports/ai-provider-credentials.port';
import { aiProviderCredentialsRef } from '../../domain/ports/ai-provider-credentials.port';
import { AiProviderValues, type AiProvider } from '../../domain/types/ai-completion.types';
import {
  ENV_VAR_BY_PROVIDER,
  providerRequiresKey,
  type AiProviderSettingsView,
} from '../../domain/types/ai-provider-credentials.types';
import { AiProviderKeyMissingError } from '../../domain/exceptions/ai-provider-key-missing.exception';
import { AiProviderSettingsNotApplicableError } from '../../domain/exceptions/ai-provider-settings-not-applicable.exception';

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  apiKey: string;
  expiresAt: number;
}

@Injectable()
export class CredentialsAiProviderAdapter implements AiProviderCredentialsPort {
  private readonly logger = new Logger(CredentialsAiProviderAdapter.name);
  private readonly cache: Map<AiProvider, CacheEntry> = new Map();
  private readonly envFallbackWarned: Set<AiProvider> = new Set();

  constructor(
    @Inject(CREDENTIALS_SERVICE_TOKEN)
    private readonly credentials: ICredentialsService,
    private readonly configService: ConfigService
  ) {}

  async getApiKey(provider: AiProvider): Promise<string> {
    if (!providerRequiresKey(provider)) {
      // Programming error: the adapter that doesn't require a key should never
      // call into the credentials port. Surface the same exception the key
      // service uses to translate "this provider takes no key" at the HTTP
      // boundary.
      throw new AiProviderSettingsNotApplicableError(provider);
    }

    const cached = this.cache.get(provider);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.apiKey;
    }

    const dbKey = await this.tryLoadFromDb(provider);
    if (dbKey !== null) {
      this.setCache(provider, dbKey);
      return dbKey;
    }

    const envKey = this.tryLoadFromEnv(provider);
    if (envKey !== null) {
      this.setCache(provider, envKey);
      return envKey;
    }

    throw new AiProviderKeyMissingError(
      `No API key configured for AI provider '${provider}'. ` +
        `Set one via PUT /ai-provider-settings/keys/${provider} or the ${ENV_VAR_BY_PROVIDER[provider] ?? 'provider env var'} ` +
        `environment variable.`
    );
  }

  async describe(provider: AiProvider): Promise<AiProviderSettingsView> {
    if (!providerRequiresKey(provider)) {
      return { provider, configured: false, source: 'none' };
    }

    const dbKey = await this.tryLoadFromDb(provider);
    if (dbKey !== null) {
      return { provider, configured: true, source: 'db' };
    }

    const envKey = this.tryReadEnvWithoutWarning(provider);
    if (envKey !== null) {
      return { provider, configured: true, source: 'env' };
    }

    return { provider, configured: false, source: 'none' };
  }

  async describeAll(): Promise<AiProviderSettingsView[]> {
    return Promise.all(AiProviderValues.map((p) => this.describe(p)));
  }

  invalidate(provider?: AiProvider): void {
    if (provider) {
      this.cache.delete(provider);
      return;
    }
    this.cache.clear();
  }

  private async tryLoadFromDb(provider: AiProvider): Promise<string | null> {
    const ref = aiProviderCredentialsRef(provider);
    try {
      const credential = await this.credentials.getByRef(ref);
      const apiKey = credential.credentialsJson?.apiKey;
      if (typeof apiKey !== 'string') {
        this.logger.error(`AI provider credential ${ref} is missing an apiKey field`);
        return null;
      }
      return apiKey;
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Read the env-var fallback. Emits a one-shot deprecation warning per
   * provider so an admin running on env-only configuration eventually sees
   * the migration pointer. Only called from `getApiKey()` (resolution-on-use)
   * — the `describe()` path uses `tryReadEnvWithoutWarning` to avoid spamming
   * the log on every status poll.
   */
  private tryLoadFromEnv(provider: AiProvider): string | null {
    const value = this.tryReadEnvWithoutWarning(provider);
    if (value !== null && !this.envFallbackWarned.has(provider)) {
      this.envFallbackWarned.add(provider);
      const envName = ENV_VAR_BY_PROVIDER[provider];
      this.logger.warn(
        `AI provider key for '${provider}' resolved from ${envName} env var. ` +
          `This fallback is deprecated — store the key encrypted via PUT /ai-provider-settings/keys/${provider} to silence this warning.`
      );
    }
    return value;
  }

  private tryReadEnvWithoutWarning(provider: AiProvider): string | null {
    const envName = ENV_VAR_BY_PROVIDER[provider];
    if (!envName) return null;
    const value = this.configService.get<string>(envName);
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private setCache(provider: AiProvider, apiKey: string): void {
    this.cache.set(provider, { apiKey, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}
