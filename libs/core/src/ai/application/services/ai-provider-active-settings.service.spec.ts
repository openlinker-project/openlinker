/**
 * AI Provider Active Settings Service — Unit Tests
 *
 * Mocks the active-setting repo + credentials port + ConfigService.
 * Asserts: env-fallback resolution when DB is empty; setActive guards on
 * key configuration (rejects when the target requires a key but none is
 * set); setActive is allowed for providers that don't require keys (fake);
 * audit log payload shape; getMultiProviderView composes correctly.
 *
 * @module libs/core/src/ai/application/services
 */
import { Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderActiveSetting } from '../../domain/entities/ai-provider-active-setting.entity';
import { AiProviderActiveSettingRepositoryPort } from '../../domain/ports/ai-provider-active-setting-repository.port';
import { AiProviderCredentialsPort } from '../../domain/ports/ai-provider-credentials.port';
import { AiProviderActivationError } from '../../domain/exceptions/ai-provider-activation.exception';
import { AiProviderActiveSettingsService } from './ai-provider-active-settings.service';

const buildConfigService = (overrides: Record<string, string | undefined> = {}): ConfigService =>
  ({
    get: <T = string>(key: string): T | undefined => overrides[key] as T | undefined,
  }) as unknown as ConfigService;

describe('AiProviderActiveSettingsService', () => {
  let repository: jest.Mocked<AiProviderActiveSettingRepositoryPort>;
  let credentials: jest.Mocked<AiProviderCredentialsPort>;
  let logSpy: jest.SpyInstance;

  const buildService = (
    config: ConfigService = buildConfigService(),
  ): AiProviderActiveSettingsService =>
    new AiProviderActiveSettingsService(repository, credentials, config);

  beforeEach(() => {
    repository = {
      findActive: jest.fn(),
      upsertActive: jest.fn(),
    };
    credentials = {
      getApiKey: jest.fn(),
      describe: jest.fn(),
      describeAll: jest.fn(),
      invalidate: jest.fn(),
    };
    logSpy = jest.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('getActive', () => {
    it('returns the persisted row when present', async () => {
      repository.findActive.mockResolvedValue(
        new AiProviderActiveSetting('openai', new Date(), 'admin'),
      );
      expect(await buildService().getActive()).toBe('openai');
    });

    it('falls back to OL_AI_PROVIDER env when no row exists', async () => {
      repository.findActive.mockResolvedValue(null);
      const service = buildService(buildConfigService({ OL_AI_PROVIDER: 'openai' }));
      expect(await service.getActive()).toBe('openai');
    });

    it('defaults to anthropic when the env value is invalid', async () => {
      repository.findActive.mockResolvedValue(null);
      const service = buildService(buildConfigService({ OL_AI_PROVIDER: 'cohere' }));
      expect(await service.getActive()).toBe('anthropic');
    });

    it('defaults to anthropic when no row and no env are set', async () => {
      repository.findActive.mockResolvedValue(null);
      expect(await buildService().getActive()).toBe('anthropic');
    });
  });

  describe('setActive', () => {
    it('rejects switching to a provider that requires a key but has none configured', async () => {
      repository.findActive.mockResolvedValue(null);
      credentials.describe.mockResolvedValue({
        provider: 'openai',
        configured: false,
        source: 'none',
      });

      await expect(buildService().setActive('openai', 'admin')).rejects.toBeInstanceOf(
        AiProviderActivationError,
      );
      expect(repository.upsertActive).not.toHaveBeenCalled();
    });

    it('persists the new active provider and logs the transition', async () => {
      repository.findActive.mockResolvedValue(
        new AiProviderActiveSetting('anthropic', new Date(), 'admin'),
      );
      credentials.describe.mockResolvedValue({
        provider: 'openai',
        configured: true,
        source: 'db',
      });
      repository.upsertActive.mockResolvedValue(
        new AiProviderActiveSetting('openai', new Date(), 'admin'),
      );

      await buildService().setActive('openai', 'admin');

      expect(repository.upsertActive).toHaveBeenCalledWith('openai', 'admin');
      const audit = logSpy.mock.calls.find(
        (call) => (call as unknown[])[0] === 'ai_provider.set_active',
      );
      expect(audit).toBeDefined();
      expect((audit as unknown as [string, Record<string, unknown>])[1]).toEqual({
        fromProvider: 'anthropic',
        toProvider: 'openai',
        actor: 'admin',
      });
    });

    it('allows activating providers that do not require a key (fake)', async () => {
      repository.findActive.mockResolvedValue(null);
      repository.upsertActive.mockResolvedValue(
        new AiProviderActiveSetting('fake', new Date(), null),
      );

      await buildService().setActive('fake');

      expect(credentials.describe).not.toHaveBeenCalled();
      expect(repository.upsertActive).toHaveBeenCalledWith('fake', null);
    });
  });

  describe('getMultiProviderView', () => {
    it('combines the active row with the per-provider status list', async () => {
      const updatedAt = new Date('2026-04-29T12:00:00Z');
      repository.findActive.mockResolvedValue(
        new AiProviderActiveSetting('openai', updatedAt, 'alice'),
      );
      credentials.describeAll.mockResolvedValue([
        { provider: 'anthropic', configured: true, source: 'db' },
        { provider: 'openai', configured: true, source: 'env' },
        { provider: 'fake', configured: false, source: 'none' },
      ]);

      const view = await buildService().getMultiProviderView();

      expect(view).toEqual({
        activeProvider: 'openai',
        activeUpdatedAt: updatedAt,
        activeUpdatedBy: 'alice',
        providers: [
          { provider: 'anthropic', configured: true, source: 'db' },
          { provider: 'openai', configured: true, source: 'env' },
          { provider: 'fake', configured: false, source: 'none' },
        ],
      });
    });

    it('falls back to env-derived active provider with null timestamps when no row exists', async () => {
      repository.findActive.mockResolvedValue(null);
      credentials.describeAll.mockResolvedValue([]);
      const service = buildService(buildConfigService({ OL_AI_PROVIDER: 'fake' }));

      const view = await service.getMultiProviderView();

      expect(view).toEqual({
        activeProvider: 'fake',
        activeUpdatedAt: null,
        activeUpdatedBy: null,
        providers: [],
      });
    });
  });
});
