/**
 * PostHog Settings Service — Unit Tests
 *
 * Mocks the settings repo + `ICredentialsService` + `PosthogEnvConfigPort`.
 * Asserts: GET view never carries the API key; DB row wins over env when
 * enabled and present; env-only fallback reproduces the pre-#1685
 * `PosthogConfigService.getConfig()` resolution when no enabled row exists
 * (including its hardcoded autocapture/sessionRecording defaults); env
 * override detection names the correct shadowed var(s); region→host mapping
 * incl. `custom`; enabled-but-unresolvable-key/host returns `null`.
 *
 * @module libs/core/src/analytics/application/services
 */
import { Logger as SharedLogger } from '@openlinker/shared/logging';
import {
  CredentialNotFoundException,
  IntegrationCredential,
  type ICredentialsService,
} from '@openlinker/core/integrations';
import { PosthogSettings } from '../../domain/entities/posthog-settings.entity';
import type { PosthogEnvConfig, PosthogEnvConfigPort } from '../../domain/ports/posthog-env-config.port';
import type { PosthogSettingsRepositoryPort } from '../../domain/ports/posthog-settings-repository.port';
import { POSTHOG_API_KEY_CREDENTIALS_REF } from '../../domain/types/posthog-credentials.types';
import { PosthogSettingsService } from './posthog-settings.service';

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
  let envConfigPort: jest.Mocked<PosthogEnvConfigPort>;
  let logSpy: jest.SpyInstance;

  const buildService = (): PosthogSettingsService =>
    new PosthogSettingsService(repository, credentials, envConfigPort);

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
    envConfigPort = {
      getConfig: jest.fn(),
    };
    logSpy = jest.spyOn(SharedLogger.prototype, 'log').mockImplementation(() => undefined);
    envConfigPort.getConfig.mockReturnValue(null);
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
      envConfigPort.getConfig.mockReturnValue({
        key: 'phc_env',
        host: 'https://eu.posthog.com',
        hostWasExplicit: false,
      });

      const view = await buildService().getSettings();

      expect(view.apiKeyConfigured).toBe(true);
    });

    it('reports wouldOverrideEnv=false when the row is disabled, even if env is set', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(false, 'eu', null, false, false, new Date(), 'admin')
      );
      envConfigPort.getConfig.mockReturnValue({
        key: 'phc_env',
        host: 'https://eu.posthog.com',
        hostWasExplicit: false,
      });

      const view = await buildService().getSettings();

      expect(view.wouldOverrideEnv).toBe(false);
      expect(view.overriddenEnvVars).toEqual([]);
    });

    it('names only OL_POSTHOG_KEY when env host was not explicitly set', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'us', null, false, false, new Date(), 'admin')
      );
      envConfigPort.getConfig.mockReturnValue({
        key: 'phc_env',
        host: 'https://eu.posthog.com',
        hostWasExplicit: false,
      });

      const view = await buildService().getSettings();

      expect(view.wouldOverrideEnv).toBe(true);
      expect(view.overriddenEnvVars).toEqual(['OL_POSTHOG_KEY']);
    });

    it('names both OL_POSTHOG_KEY and OL_POSTHOG_HOST when env host was explicitly set', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'us', null, false, false, new Date(), 'admin')
      );
      envConfigPort.getConfig.mockReturnValue({
        key: 'phc_env',
        host: 'https://us.posthog.com',
        hostWasExplicit: true,
      });

      const view = await buildService().getSettings();

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
      const envConfig: PosthogEnvConfig = {
        key: 'phc_env',
        host: 'https://eu.posthog.com',
        hostWasExplicit: false,
      };
      envConfigPort.getConfig.mockReturnValue(envConfig);

      const config = await buildService().resolveConfig();

      expect(config).toEqual({
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
      envConfigPort.getConfig.mockReturnValue({
        key: 'phc_env',
        host: 'https://eu.posthog.com',
        hostWasExplicit: false,
      });

      const config = await buildService().resolveConfig();

      expect(config).toEqual({
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
      envConfigPort.getConfig.mockReturnValue({
        key: 'phc_env',
        host: 'https://eu.posthog.com',
        hostWasExplicit: false,
      });

      const config = await buildService().resolveConfig();

      expect(config).toEqual({
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

    it('falls back to the env key when the DB row is enabled but no credential row exists', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'eu', null, false, false, new Date(), 'admin')
      );
      envConfigPort.getConfig.mockReturnValue({
        key: 'phc_env',
        host: 'https://eu.posthog.com',
        hostWasExplicit: false,
      });

      const config = await buildService().resolveConfig();

      expect(config?.key).toBe('phc_env');
    });

    it('returns null when enabled but no key resolves from either the credential store or env', async () => {
      repository.findSettings.mockResolvedValue(
        new PosthogSettings(true, 'eu', null, false, false, new Date(), 'admin')
      );

      await expect(buildService().resolveConfig()).resolves.toBeNull();
    });
  });
});
