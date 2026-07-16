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
 * to the legacy env vars `OL_POSTHOG_KEY` / `OL_POSTHOG_HOST` via
 * `PosthogEnvConfigPort` (implemented by the host's `PosthogConfigService`),
 * finally returning `null` when neither resolves to a usable key — the
 * demo-only analytics seam stays deny-by-default.
 *
 * @module libs/core/src/analytics/application/services
 * @implements {IPosthogSettingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CREDENTIALS_SERVICE_TOKEN,
  CredentialNotFoundException,
  type ICredentialsService,
} from '@openlinker/core/integrations';
import { POSTHOG_ENV_CONFIG_PORT_TOKEN, POSTHOG_SETTINGS_REPOSITORY_TOKEN } from '../../analytics.tokens';
import type { PosthogSettings } from '../../domain/entities/posthog-settings.entity';
import { PosthogEnvConfigPort } from '../../domain/ports/posthog-env-config.port';
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

@Injectable()
export class PosthogSettingsService implements IPosthogSettingsService {
  private readonly logger = new Logger(PosthogSettingsService.name);

  constructor(
    @Inject(POSTHOG_SETTINGS_REPOSITORY_TOKEN)
    private readonly repository: PosthogSettingsRepositoryPort,
    @Inject(CREDENTIALS_SERVICE_TOKEN)
    private readonly credentials: ICredentialsService,
    @Inject(POSTHOG_ENV_CONFIG_PORT_TOKEN)
    private readonly envConfigPort: PosthogEnvConfigPort
  ) {}

  async getSettings(): Promise<PosthogSettingsView> {
    const row = await this.repository.findSettings();
    const apiKeyConfigured = await this.isApiKeyConfigured();
    const { wouldOverrideEnv, overriddenEnvVars } = this.computeEnvOverride(row);

    if (!row) {
      return {
        enabled: false,
        region: 'eu',
        customHost: null,
        autocapture: false,
        sessionRecording: false,
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
      };
    }

    // No enabled DB row — env fallback, preserving the exact pre-#1685
    // behavior (autocapture/session-recording were previously hardcoded
    // client-side; pin the same values here so an env-only deployment sees
    // no behavior change on upgrade).
    const envConfig = this.envConfigPort.getConfig();
    if (!envConfig) {
      return null;
    }
    return {
      key: envConfig.key,
      host: envConfig.host,
      autocapture: false,
      sessionRecording: true,
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

  private computeEnvOverride(row: PosthogSettings | null): {
    wouldOverrideEnv: boolean;
    overriddenEnvVars: string[];
  } {
    if (!row?.enabled) {
      return { wouldOverrideEnv: false, overriddenEnvVars: [] };
    }
    const envConfig = this.envConfigPort.getConfig();
    if (!envConfig) {
      return { wouldOverrideEnv: false, overriddenEnvVars: [] };
    }
    const overriddenEnvVars = ['OL_POSTHOG_KEY'];
    if (envConfig.hostWasExplicit) {
      overriddenEnvVars.push('OL_POSTHOG_HOST');
    }
    return { wouldOverrideEnv: true, overriddenEnvVars };
  }

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
        return this.envConfigPort.getConfig()?.key ?? null;
      }
      throw error;
    }
  }

  private async isApiKeyConfigured(): Promise<boolean> {
    try {
      await this.credentials.getByRef(POSTHOG_API_KEY_CREDENTIALS_REF);
      return true;
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        return Boolean(this.envConfigPort.getConfig()?.key);
      }
      throw error;
    }
  }
}
