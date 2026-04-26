/**
 * Credentials-backed AI Provider Adapter
 *
 * Implementation of `AiProviderCredentialsPort` backed by the encrypted
 * `integration_credentials` table. Mirrors `CredentialsWebhookSecretAdapter`:
 * 60-second cache, DB → env → throw resolution, one-shot deprecation
 * warning when the env fallback is used.
 *
 * The active provider is read from `OL_AI_PROVIDER` (default `anthropic`).
 * For `provider=fake`, the adapter short-circuits — `describe()` reports
 * `{ provider: 'fake', configured: false, source: 'none' }` without any DB
 * or env lookup, and `getApiKey()` throws (the `FakeAiCompletionAdapter`
 * never invokes it; if it does, that's a programming error).
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
import { Logger, CryptoService } from '@openlinker/shared';
import {
  IntegrationCredentialRepositoryPort,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  CredentialNotFoundException,
} from '@openlinker/core/integrations';
import {
  AiProviderCredentialsPort,
  aiProviderCredentialsRef,
} from '../../domain/ports/ai-provider-credentials.port';
import {
  AiProvider,
  AiProviderValues,
} from '../../domain/types/ai-completion.types';
import { AiProviderSettingsView } from '../../domain/types/ai-provider-credentials.types';
import { AiProviderKeyMissingError } from '../../domain/exceptions/ai-provider-key-missing.exception';
import { AiProviderSettingsNotApplicableError } from '../../domain/exceptions/ai-provider-settings-not-applicable.exception';

const DEFAULT_PROVIDER: AiProvider = 'anthropic';
const CACHE_TTL_MS = 60 * 1000;

/**
 * Env-var name for the legacy fallback per provider. The shape mirrors the
 * vendor SDK convention so an unmodified fresh checkout works as before.
 * Today only `anthropic` is mapped — adding a provider also adds its env
 * var here.
 */
const ENV_VAR_BY_PROVIDER: Partial<Record<AiProvider, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
};

const isAiProvider = (value: string): value is AiProvider =>
  (AiProviderValues as readonly string[]).includes(value);

interface CacheEntry {
  apiKey: string;
  expiresAt: number;
}

@Injectable()
export class CredentialsAiProviderAdapter implements AiProviderCredentialsPort {
  private readonly logger = new Logger(CredentialsAiProviderAdapter.name);
  private readonly activeProvider: AiProvider;
  private cache: CacheEntry | null = null;
  private envFallbackWarned = false;

  constructor(
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    private readonly credentialRepository: IntegrationCredentialRepositoryPort,
    private readonly crypto: CryptoService,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string>('OL_AI_PROVIDER') ?? DEFAULT_PROVIDER;
    this.activeProvider = isAiProvider(raw) ? raw : DEFAULT_PROVIDER;
  }

  async getApiKey(): Promise<string> {
    if (!this.providerRequiresKey(this.activeProvider)) {
      // Programming error: the adapter that doesn't require a key should never
      // call into the credentials port. Use the same exception the service
      // uses to translate "this provider takes no key" at the HTTP boundary.
      throw new AiProviderSettingsNotApplicableError(this.activeProvider);
    }

    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.apiKey;
    }

    const dbKey = await this.tryLoadFromDb();
    if (dbKey !== null) {
      this.setCache(dbKey);
      return dbKey;
    }

    const envKey = this.tryLoadFromEnv();
    if (envKey !== null) {
      this.setCache(envKey);
      return envKey;
    }

    throw new AiProviderKeyMissingError(
      `No API key configured for AI provider '${this.activeProvider}'. ` +
        `Set one via PUT /ai-provider-settings or the ${ENV_VAR_BY_PROVIDER[this.activeProvider] ?? 'provider env var'} ` +
        `environment variable.`,
    );
  }

  async describe(): Promise<AiProviderSettingsView> {
    if (!this.providerRequiresKey(this.activeProvider)) {
      return { provider: this.activeProvider, configured: false, source: 'none' };
    }

    const dbKey = await this.tryLoadFromDb();
    if (dbKey !== null) {
      return { provider: this.activeProvider, configured: true, source: 'db' };
    }

    const envKey = this.tryReadEnvWithoutWarning();
    if (envKey !== null) {
      return { provider: this.activeProvider, configured: true, source: 'env' };
    }

    return { provider: this.activeProvider, configured: false, source: 'none' };
  }

  invalidate(): void {
    this.cache = null;
  }

  private providerRequiresKey(provider: AiProvider): boolean {
    return ENV_VAR_BY_PROVIDER[provider] !== undefined;
  }

  private async tryLoadFromDb(): Promise<string | null> {
    const ref = aiProviderCredentialsRef(this.activeProvider);
    try {
      const credential = await this.credentialRepository.getByRef(ref);
      const ciphertext = credential.credentialsJson?.ciphertext;
      if (typeof ciphertext !== 'string') {
        this.logger.error(
          `AI provider credential ${ref} is missing a ciphertext field`,
        );
        return null;
      }
      if (!credential.encrypted) {
        this.logger.warn(
          `AI provider credential ${ref} is not marked encrypted — returning raw value`,
        );
        return ciphertext;
      }
      return this.crypto.decrypt(ciphertext);
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Read the env-var fallback. Emits a one-shot deprecation warning so an
   * admin running on env-only configuration eventually sees the migration
   * pointer. Only called from `getApiKey()` (resolution-on-use) — the
   * `describe()` path uses `tryReadEnvWithoutWarning` to avoid spamming the
   * log on every status poll.
   */
  private tryLoadFromEnv(): string | null {
    const value = this.tryReadEnvWithoutWarning();
    if (value !== null && !this.envFallbackWarned) {
      this.envFallbackWarned = true;
      const envName = ENV_VAR_BY_PROVIDER[this.activeProvider];
      this.logger.warn(
        `AI provider key for '${this.activeProvider}' resolved from ${envName} env var. ` +
          `This fallback is deprecated — store the key encrypted via PUT /ai-provider-settings to silence this warning.`,
      );
    }
    return value;
  }

  private tryReadEnvWithoutWarning(): string | null {
    const envName = ENV_VAR_BY_PROVIDER[this.activeProvider];
    if (!envName) return null;
    const value = this.configService.get<string>(envName);
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private setCache(apiKey: string): void {
    this.cache = { apiKey, expiresAt: Date.now() + CACHE_TTL_MS };
  }
}
