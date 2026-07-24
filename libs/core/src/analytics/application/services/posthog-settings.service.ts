/**
 * PostHog Settings Service
 *
 * Implements `IPosthogSettingsService`. Non-secret settings (enabled,
 * region, custom host, autocapture, session recording) live in the singleton
 * `posthog_settings` table; the PostHog project API key is stored separately
 * as an encrypted credential (`ref = 'posthog:api-key'`) via
 * `ICredentialsService` (`@openlinker/core/integrations`).
 *
 * Read-through model: `resolveConfig()` hits the repository (and, when
 * enabled, the credentials store) on every call — no in-process cache,
 * mirroring `MailerSettingsService`.
 *
 * Resolution order: an enabled DB row takes priority; otherwise falls back
 * to the legacy env vars `OL_POSTHOG_KEY` / `OL_POSTHOG_HOST`, read directly
 * via the (globally-registered) `ConfigService` — mirroring exactly how
 * `MailerSettingsService` reads `MAIL_*` env vars, rather than routing
 * through a host-supplied port. An earlier revision introduced a
 * `PosthogEnvConfigPort` seam bound by `SystemModule`, but that put the
 * consuming service (this one, provided by `AnalyticsModule`) and the token
 * binding (in `SystemModule`, which only *imports* `AnalyticsModule`) in
 * modules with no DI visibility into each other — Nest's injector cannot
 * resolve a dependency "upward" into an importing module. Reading env vars
 * directly here, exactly like Mailer, needs no such seam because
 * `ConfigModule` is global.
 *
 * IMPORTANT (safety): once a DB row is `enabled`, the API key MUST come
 * from the DB-stored credential — `readApiKey()` does not fall back to the
 * env key. Silently reusing an env-configured key together with a
 * DB-selected region is exactly the failure mode this feature exists to
 * prevent (an API key provisioned for one PostHog project region, paired
 * with a different region selected in the DB row, silently drops every
 * event — see the design rationale in `posthog-settings.types.ts`). An
 * enabled row with no stored credential resolves to `null` (deny-by-
 * default) rather than borrowing an unrelated env value.
 *
 * @module libs/core/src/analytics/application/services
 * @implements {IPosthogSettingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared/logging';
import {
  CREDENTIALS_SERVICE_TOKEN,
  CredentialNotFoundException,
  type ICredentialsService,
} from '@openlinker/core/integrations';
import { POSTHOG_SETTINGS_REPOSITORY_TOKEN } from '../../analytics.tokens';
import type { PosthogSettings } from '../../domain/entities/posthog-settings.entity';
import { PosthogSettingsRepositoryPort } from '../../domain/ports/posthog-settings-repository.port';
import { POSTHOG_API_KEY_CREDENTIALS_REF } from '../../domain/types/posthog-credentials.types';
import type {
  PosthogRegion,
  PosthogSettingsInput,
  PosthogSettingsView,
  ResolvedPosthogConfig,
} from '../../domain/types/posthog-settings.types';
import type { IPosthogSettingsService } from './posthog-settings.service.interface';

const POSTHOG_EU_INGESTION_HOST = 'https://eu.i.posthog.com';
const POSTHOG_US_INGESTION_HOST = 'https://us.i.posthog.com';
const DEFAULT_ENV_POSTHOG_HOST = 'https://eu.posthog.com';

interface EnvPosthogConfig {
  key: string;
  host: string;
  /** True when `OL_POSTHOG_HOST` was explicitly set (vs. defaulted) — lets
   * `computeEnvOverride` name the exact env var(s) a saved row would shadow,
   * without ever exposing the env value itself. */
  hostWasExplicit: boolean;
}

@Injectable()
export class PosthogSettingsService implements IPosthogSettingsService {
  private readonly logger = new Logger(PosthogSettingsService.name);

  constructor(
    @Inject(POSTHOG_SETTINGS_REPOSITORY_TOKEN)
    private readonly repository: PosthogSettingsRepositoryPort,
    @Inject(CREDENTIALS_SERVICE_TOKEN)
    private readonly credentials: ICredentialsService,
    private readonly configService: ConfigService
  ) {}

  async getSettings(): Promise<PosthogSettingsView> {
    const row = await this.repository.findSettings();
    const apiKeyConfigured = await this.isApiKeyConfigured();
    const { wouldOverrideEnv, overriddenEnvVars } = await this.computeEnvOverride(row);

    if (!row) {
      return {
        enabled: false,
        region: 'eu',
        customHost: null,
        autocapture: false,
        sessionRecording: false,
        productEventsEnabled: false,
        enabledEventGroups: [],
        apiKeyConfigured,
        wouldOverrideEnv,
        overriddenEnvVars,
        updatedAt: null,
        updatedBy: null,
      };
    }

    return {
      enabled: row.enabled,
      region: row.region,
      customHost: row.customHost,
      autocapture: row.autocapture,
      sessionRecording: row.sessionRecording,
      productEventsEnabled: row.productEventsEnabled,
      enabledEventGroups: row.enabledEventGroups,
      apiKeyConfigured,
      wouldOverrideEnv,
      overriddenEnvVars,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }

  async updateSettings(input: PosthogSettingsInput, actorUserId?: string): Promise<void> {
    await this.repository.upsertSettings(input, actorUserId ?? null);
    this.logger.log('posthog_settings.update', {
      enabled: input.enabled,
      region: input.region,
      actor: actorUserId ?? 'system',
    });
  }

  async setApiKey(apiKey: string, actorUserId?: string): Promise<void> {
    try {
      await this.credentials.update(POSTHOG_API_KEY_CREDENTIALS_REF, {
        credentialsJson: { apiKey },
      });
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        await this.credentials.create({
          ref: POSTHOG_API_KEY_CREDENTIALS_REF,
          platformType: 'posthog',
          credentialsJson: { apiKey },
        });
      } else {
        throw error;
      }
    }
    this.logger.log('posthog_settings.set_credentials', { actor: actorUserId ?? 'system' });
  }

  async clearApiKey(actorUserId?: string): Promise<void> {
    await this.credentials.delete(POSTHOG_API_KEY_CREDENTIALS_REF);
    this.logger.log('posthog_settings.clear_credentials', { actor: actorUserId ?? 'system' });
  }

  async resolveConfig(): Promise<ResolvedPosthogConfig | null> {
    const row = await this.repository.findSettings();
    if (row?.enabled) {
      const key = await this.readApiKey();
      if (!key) {
        return null;
      }
      const host = this.resolveHost(row.region, row.customHost);
      if (!host) {
        return null;
      }
      return {
        key,
        host,
        autocapture: row.autocapture,
        sessionRecording: row.sessionRecording,
        productEventsEnabled: row.productEventsEnabled,
        enabledEventGroups: row.enabledEventGroups,
      };
    }

    // No enabled DB row — env fallback, preserving the exact pre-#1685
    // behavior (autocapture/session-recording were previously hardcoded
    // client-side; pin the same values here so an env-only deployment sees
    // no behavior change on upgrade). Product events are DB-only — an
    // env-configured install never gets them, since there is no env var for
    // group enablement.
    const envConfig = this.readEnvConfig();
    if (!envConfig) {
      return null;
    }
    return {
      key: envConfig.key,
      host: envConfig.host,
      autocapture: false,
      sessionRecording: true,
      productEventsEnabled: false,
      enabledEventGroups: [],
    };
  }

  private resolveHost(region: PosthogRegion, customHost: string | null): string | null {
    if (region === 'eu') {
      return POSTHOG_EU_INGESTION_HOST;
    }
    if (region === 'us') {
      return POSTHOG_US_INGESTION_HOST;
    }
    return customHost && customHost.trim().length > 0 ? customHost : null;
  }

  /**
   * `wouldOverrideEnv` must only be true when saving would ACTUALLY replace
   * a working env-only config with a working DB-only one — i.e. the row is
   * enabled AND already has its own stored credential (not just
   * `row.enabled`, which an earlier revision used and which over-claimed an
   * override even when the row had no key of its own — see the service
   * header doc for the failure mode this caused).
   */
  private async computeEnvOverride(row: PosthogSettings | null): Promise<{
    wouldOverrideEnv: boolean;
    overriddenEnvVars: string[];
  }> {
    if (!row?.enabled) {
      return { wouldOverrideEnv: false, overriddenEnvVars: [] };
    }
    const [hasDbCredential, envConfig] = await Promise.all([
      this.hasDbCredential(),
      Promise.resolve(this.readEnvConfig()),
    ]);
    if (!hasDbCredential || !envConfig) {
      return { wouldOverrideEnv: false, overriddenEnvVars: [] };
    }
    const overriddenEnvVars = ['OL_POSTHOG_KEY'];
    if (envConfig.hostWasExplicit) {
      overriddenEnvVars.push('OL_POSTHOG_HOST');
    }
    return { wouldOverrideEnv: true, overriddenEnvVars };
  }

  /**
   * DB-only — used by the enabled-row resolution path. Deliberately does
   * NOT fall back to the env key (see the service header doc).
   */
  private async readApiKey(): Promise<string | null> {
    try {
      const credential = await this.credentials.getByRef(POSTHOG_API_KEY_CREDENTIALS_REF);
      const apiKey = credential.credentialsJson?.apiKey;
      if (typeof apiKey !== 'string') {
        this.logger.error(
          `PostHog credential ${POSTHOG_API_KEY_CREDENTIALS_REF} is missing an apiKey field`
        );
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

  private async hasDbCredential(): Promise<boolean> {
    try {
      await this.credentials.getByRef(POSTHOG_API_KEY_CREDENTIALS_REF);
      return true;
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Informational only (surfaced on the settings tile as "API key:
   * Configured/Not set") — reports true if EITHER a DB credential or an env
   * key resolves, regardless of `enabled`. Unlike `readApiKey()`, this does
   * not drive `resolveConfig()`'s actual behavior, so the DB-or-env breadth
   * here is safe.
   */
  private async isApiKeyConfigured(): Promise<boolean> {
    const dbConfigured = await this.hasDbCredential();
    return dbConfigured || Boolean(this.readEnvConfig()?.key);
  }

  private readEnvConfig(): EnvPosthogConfig | null {
    const key = this.configService.get<string>('OL_POSTHOG_KEY', '').trim();
    if (!key) {
      return null;
    }
    const rawHost = this.configService.get<string>('OL_POSTHOG_HOST', '').trim();
    return {
      key,
      host: rawHost || DEFAULT_ENV_POSTHOG_HOST,
      hostWasExplicit: rawHost.length > 0,
    };
  }
}
