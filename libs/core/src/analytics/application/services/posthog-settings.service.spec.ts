/**
 * PostHog Settings Service — Unit Tests
 *
 * Mocks the settings repo + `ICredentialsService` + `ConfigService`.
 * Asserts: GET view never carries the API key; DB row wins over env when
 * enabled AND the row has its own stored credential; env-only fallback
 * reproduces the pre-#1685 `PosthogConfigService.getConfig()` resolution
 * when no enabled row exists (including its hardcoded
 * autocapture/sessionRecording defaults); env override detection names the
 * correct shadowed var(s) and requires an actual DB credential (not just
 * `enabled`); region→host mapping incl. `custom`;
 * enabled-but-unresolvable-key/host returns `null`.
 *
 * @module libs/core/src/analytics/application/services
 */
import type { ConfigService } from '@nestjs/config';
import { Logger as SharedLogger } from '@openlinker/shared/logging';
import {
  CredentialNotFoundException,
  IntegrationCredential,
  type ICredentialsService,
} from '@openlinker/core/integrations';
import { PosthogSettings } from '../../domain/entities/posthog-settings.entity';
import type { PosthogSettingsRepositoryPort } from '../../domain/ports/posthog-settings-repository.port';
import { POSTHOG_API_KEY_CREDENTIALS_REF } from '../../domain/types/posthog-credentials.types';
import { PosthogSettingsService } from './posthog-settings.service';

const buildConfigService = (overrides: Record<string, string | undefined> = {}): ConfigService =>
  ({
    get: <T = string>(key: string, fallback?: T): T | undefined =>
      (overrides[key] as T | undefined) ?? fallback,
  }) as unknown as ConfigService;

const buildCredential = (apiKey: string): IntegrationCredential =>
  new IntegrationCredential(
    'cred-1',
    POSTHOG_API_KEY_CREDENTIALS_REF,
    'posthog',
    { apiKey },
    new Date(),
    new Date()
  );

describe('PosthogSettingsService', () => {
  let repository: jest.Mocked<PosthogSettingsRepositoryPort>;
  let credentials: jest.Mocked<ICredentialsService>;
  let logSpy: jest.SpyInstance;

  const buildService = (config: ConfigService = buildConfigService()): PosthogSettingsService =>
    new PosthogSettingsService(repository, credentials, config);

  beforeEach(() => {
    repository = {
      findSettings: jest.fn(),
      upsertSettings: jest.fn(),
    };
    credentials = {
      getByRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    logSpy = jest.spyOn(SharedLogger.prototype, 'log').mockImplementation(() => undefined);
    credentials.getByRef.mockRejectedValue(
      new CredentialNotFoundException(POSTHOG_API_KEY_CREDENTIALS_REF)
    );
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('getSettings', () => {
    it('returns off defaults with no timestamps when no row exists', async () => {
      repository.findSettings.mockResolvedValue(null);

      const view = await buildService().getSettings();

      expect(view).toEqual({
        enabled: false,
        region: 'eu',
        customHost: null,
        autocapture: false,
        sessionRecording: false,
        apiKeyConfigured: false,
        wouldOverrideEnv: false,
        overriddenEnvVars: [],
        updatedAt: null,
        updatedBy: null,
      });
    });

    it('never includes the API key, only whether one is configured', async () => {
      const updatedAt = new Date('2026-05-01T00:00:00Z');
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'eu', null, true, true, updatedAt, 'admin')
      );
      credentials.getByRef.mockResolvedValue(buildCredential('phc_super_secret'));

      const view = await buildService().getSettings();

      expect(view.apiKeyConfigured).toBe(true);
      expect(JSON.stringify(view)).not.toContain('phc_super_secret');
    });

    it('reports apiKeyConfigured=true from env when no DB credential exists', async () => {
      repository.findSettings.mockResolvedValue(null);
      const config = buildConfigService({ OL_POSTHOG_KEY: 'phc_env' });

      const view = await buildService(config).getSettings();

      expect(view.apiKeyConfigured).toBe(true);
    });

    it('reports wouldOverrideEnv=false when the row is disabled, even if env is set', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(false, 'eu', null, false, false, new Date(), 'admin')
      );
      const config = buildConfigService({ OL_POSTHOG_KEY: 'phc_env' });

      const view = await buildService(config).getSettings();

      expect(view.wouldOverrideEnv).toBe(false);
      expect(view.overriddenEnvVars).toEqual([]);
    });

    it('reports wouldOverrideEnv=false when the row is enabled but has no stored credential of its own, even if env is set', async () => {
      // Regression guard: an earlier revision reported an override here even
      // though resolveConfig() would (correctly) return null in this exact
      // state — nothing is actually being overridden if the row has no key.
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'us', null, false, false, new Date(), 'admin')
      );
      const config = buildConfigService({ OL_POSTHOG_KEY: 'phc_env' });

      const view = await buildService(config).getSettings();

      expect(view.wouldOverrideEnv).toBe(false);
      expect(view.overriddenEnvVars).toEqual([]);
    });

    it('names only OL_POSTHOG_KEY when env host was not explicitly set', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'us', null, false, false, new Date(), 'admin')
      );
      credentials.getByRef.mockResolvedValue(buildCredential('phc_db'));
      const config = buildConfigService({ OL_POSTHOG_KEY: 'phc_env' });

      const view = await buildService(config).getSettings();

      expect(view.wouldOverrideEnv).toBe(true);
      expect(view.overriddenEnvVars).toEqual(['OL_POSTHOG_KEY']);
    });

    it('names both OL_POSTHOG_KEY and OL_POSTHOG_HOST when env host was explicitly set', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'us', null, false, false, new Date(), 'admin')
      );
      credentials.getByRef.mockResolvedValue(buildCredential('phc_db'));
      const config = buildConfigService({
        OL_POSTHOG_KEY: 'phc_env',
        OL_POSTHOG_HOST: 'https://us.posthog.com',
      });

      const view = await buildService(config).getSettings();

      expect(view.overriddenEnvVars).toEqual(['OL_POSTHOG_KEY', 'OL_POSTHOG_HOST']);
    });
  });

  describe('updateSettings', () => {
    it('delegates to the repository', async () => {
      repository.upsertSettings.mockResolvedValue(
        new PosthogSettings(true, 'us', null, true, true, new Date(), 'admin')
      );

      await buildService().updateSettings(
        { enabled: true, region: 'us', customHost: null, autocapture: true, sessionRecording: true },
        'admin'
      );

      expect(repository.upsertSettings).toHaveBeenCalledWith(
        { enabled: true, region: 'us', customHost: null, autocapture: true, sessionRecording: true },
        'admin'
      );
    });
  });

  describe('setApiKey / clearApiKey', () => {
    it('updates the existing credential when present', async () => {
      credentials.update.mockResolvedValue(buildCredential('phc_new'));

      await buildService().setApiKey('phc_new', 'admin');

      expect(credentials.update).toHaveBeenCalledWith(POSTHOG_API_KEY_CREDENTIALS_REF, {
        credentialsJson: { apiKey: 'phc_new' },
      });
      expect(credentials.create).not.toHaveBeenCalled();
    });

    it('creates the credential when the ref does not exist yet', async () => {
      credentials.update.mockRejectedValue(
        new CredentialNotFoundException(POSTHOG_API_KEY_CREDENTIALS_REF)
      );
      credentials.create.mockResolvedValue(buildCredential('phc_new'));

      await buildService().setApiKey('phc_new', 'admin');

      expect(credentials.create).toHaveBeenCalledWith({
        ref: POSTHOG_API_KEY_CREDENTIALS_REF,
        platformType: 'posthog',
        credentialsJson: { apiKey: 'phc_new' },
      });
    });

    it('clears the credential', async () => {
      credentials.delete.mockResolvedValue(true);

      await buildService().clearApiKey('admin');

      expect(credentials.delete).toHaveBeenCalledWith(POSTHOG_API_KEY_CREDENTIALS_REF);
    });
  });

  describe('resolveConfig', () => {
    it('returns null when no DB row and no env are set', async () => {
      repository.findSettings.mockResolvedValue(null);

      await expect(buildService().resolveConfig()).resolves.toBeNull();
    });

    it('falls back to env when no DB row exists, pinning pre-#1685 autocapture/sessionRecording defaults', async () => {
      repository.findSettings.mockResolvedValue(null);
      const config = buildConfigService({ OL_POSTHOG_KEY: 'phc_env' });

      const resolved = await buildService(config).resolveConfig();

      expect(resolved).toEqual({
        key: 'phc_env',
        host: 'https://eu.posthog.com',
        autocapture: false,
        sessionRecording: true,
      });
    });

    it('falls back to env when the DB row is disabled', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(false, 'us', null, true, true, new Date(), 'admin')
      );
      const config = buildConfigService({ OL_POSTHOG_KEY: 'phc_env' });

      const resolved = await buildService(config).resolveConfig();

      expect(resolved).toEqual({
        key: 'phc_env',
        host: 'https://eu.posthog.com',
        autocapture: false,
        sessionRecording: true,
      });
    });

    it('DB row wins over env when enabled, using its own autocapture/sessionRecording', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'us', null, true, false, new Date(), 'admin')
      );
      credentials.getByRef.mockResolvedValue(buildCredential('phc_db'));
      const config = buildConfigService({ OL_POSTHOG_KEY: 'phc_env' });

      const resolved = await buildService(config).resolveConfig();

      expect(resolved).toEqual({
        key: 'phc_db',
        host: 'https://us.i.posthog.com',
        autocapture: true,
        sessionRecording: false,
      });
    });

    it('resolves the eu region to the EU ingestion host', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'eu', null, false, false, new Date(), 'admin')
      );
      credentials.getByRef.mockResolvedValue(buildCredential('phc_db'));

      const config = await buildService().resolveConfig();

      expect(config?.host).toBe('https://eu.i.posthog.com');
    });

    it('resolves the custom region to the configured custom host', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'custom', 'https://posthog.mycompany.com', false, false, new Date(), 'admin')
      );
      credentials.getByRef.mockResolvedValue(buildCredential('phc_db'));

      const config = await buildService().resolveConfig();

      expect(config?.host).toBe('https://posthog.mycompany.com');
    });

    it('returns null when region is custom but no custom host is set', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'custom', null, false, false, new Date(), 'admin')
      );
      credentials.getByRef.mockResolvedValue(buildCredential('phc_db'));

      await expect(buildService().resolveConfig()).resolves.toBeNull();
    });

    it('does NOT fall back to the env key when the DB row is enabled but has no stored credential of its own', async () => {
      // Safety-critical: an enabled row must be self-contained. Silently
      // reusing an env-provisioned key (validated against whatever region
      // the operator originally set OL_POSTHOG_HOST for) together with a
      // DB-selected region is exactly the failure mode this feature exists
      // to prevent (#1685) - deny-by-default instead.
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'eu', null, false, false, new Date(), 'admin')
      );
      const config = buildConfigService({ OL_POSTHOG_KEY: 'phc_env' });

      await expect(buildService(config).resolveConfig()).resolves.toBeNull();
    });

    it('returns null when enabled but no key resolves from either the credential store or env', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'eu', null, false, false, new Date(), 'admin')
      );

      await expect(buildService().resolveConfig()).resolves.toBeNull();
    });
  });
});
