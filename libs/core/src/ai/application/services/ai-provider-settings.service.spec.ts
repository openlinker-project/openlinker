/**
 * AI Provider Settings Service — Unit Tests
 *
 * Mocks all collaborators (credentials port, credential repo, crypto,
 * config). Asserts: write paths upsert with encryption + invalidate the
 * port; fake-provider writes throw the not-applicable error; the structured
 * log payload matches the webhook-secret precedent shape.
 *
 * @module libs/core/src/ai/application/services
 */
import { Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@openlinker/shared';
import {
  IntegrationCredentialRepositoryPort,
  CredentialNotFoundException,
} from '@openlinker/core/integrations';
import { IntegrationCredential } from '@openlinker/core/integrations/domain/entities/integration-credential.entity';
import {
  AiProviderCredentialsPort,
  aiProviderCredentialsRef,
} from '../../domain/ports/ai-provider-credentials.port';
import { AiProviderSettingsView } from '../../domain/types/ai-provider-credentials.types';
import { AiProviderSettingsNotApplicableError } from '../../domain/exceptions/ai-provider-settings-not-applicable.exception';
import { AiProviderSettingsService } from './ai-provider-settings.service';

const buildConfigService = (overrides: Record<string, string | undefined> = {}): ConfigService =>
  ({
    get: <T = string>(key: string, defaultValue?: T): T => {
      const v = overrides[key];
      return (v ?? defaultValue) as T;
    },
  }) as unknown as ConfigService;

const sampleCredential = (ref: string): IntegrationCredential =>
  new IntegrationCredential(
    'cred-id',
    ref,
    'anthropic',
    { ciphertext: 'cipher' },
    true,
    new Date(),
    new Date(),
  );

describe('AiProviderSettingsService', () => {
  let credentialsPort: jest.Mocked<AiProviderCredentialsPort>;
  let repository: jest.Mocked<IntegrationCredentialRepositoryPort>;
  let crypto: jest.Mocked<Pick<CryptoService, 'encrypt' | 'decrypt'>>;
  let logSpy: jest.SpyInstance;

  const buildService = (
    config: ConfigService = buildConfigService({ OL_AI_PROVIDER: 'anthropic' }),
  ): AiProviderSettingsService =>
    new AiProviderSettingsService(
      credentialsPort,
      repository,
      crypto as unknown as CryptoService,
      config,
    );

  beforeEach(() => {
    credentialsPort = {
      getApiKey: jest.fn(),
      describe: jest.fn(),
      invalidate: jest.fn(),
    };
    repository = {
      getByRef: jest.fn(),
      create: jest.fn().mockResolvedValue(sampleCredential('ai-provider:anthropic')),
      update: jest.fn().mockResolvedValue(sampleCredential('ai-provider:anthropic')),
      delete: jest.fn().mockResolvedValue(true),
    };
    crypto = {
      encrypt: jest.fn().mockReturnValue('cipher'),
      decrypt: jest.fn(),
    };
    logSpy = jest.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('get', () => {
    it('delegates to credentialsPort.describe', async () => {
      const view: AiProviderSettingsView = {
        provider: 'anthropic',
        configured: true,
        source: 'db',
      };
      credentialsPort.describe.mockResolvedValue(view);

      const result = await buildService().get();

      expect(result).toBe(view);
      expect(credentialsPort.describe).toHaveBeenCalledTimes(1);
    });
  });

  describe('set', () => {
    it('updates an existing row, invalidates the cache, and logs the actor', async () => {
      await buildService().set('sk-ant-test-12345678', 'user-1');

      expect(crypto.encrypt).toHaveBeenCalledWith('sk-ant-test-12345678');
      expect(repository.update).toHaveBeenCalledWith('ai-provider:anthropic', {
        credentialsJson: { ciphertext: 'cipher' },
        encrypted: true,
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(credentialsPort.invalidate).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('ai_provider_settings.set', {
        provider: 'anthropic',
        actor: 'user-1',
      });
    });

    it('creates the row when no existing credential is present', async () => {
      repository.update.mockRejectedValueOnce(new CredentialNotFoundException('x'));

      await buildService().set('sk-ant-test-12345678');

      expect(repository.create).toHaveBeenCalledWith({
        ref: 'ai-provider:anthropic',
        platformType: 'anthropic',
        credentialsJson: { ciphertext: 'cipher' },
        encrypted: true,
      });
      expect(credentialsPort.invalidate).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('ai_provider_settings.set', {
        provider: 'anthropic',
        actor: 'system',
      });
    });

    it('rethrows non-NotFound repository errors without creating', async () => {
      repository.update.mockRejectedValueOnce(new Error('db down'));

      await expect(buildService().set('sk-ant-test-12345678')).rejects.toThrow('db down');
      expect(repository.create).not.toHaveBeenCalled();
      expect(credentialsPort.invalidate).not.toHaveBeenCalled();
    });

    it('throws AiProviderSettingsNotApplicableError when active provider is fake', async () => {
      const service = buildService(buildConfigService({ OL_AI_PROVIDER: 'fake' }));

      await expect(service.set('whatever-key')).rejects.toBeInstanceOf(
        AiProviderSettingsNotApplicableError,
      );
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(credentialsPort.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('deletes the row, invalidates the cache, and logs the actor', async () => {
      await buildService().clear('user-2');

      expect(repository.delete).toHaveBeenCalledWith('ai-provider:anthropic');
      expect(credentialsPort.invalidate).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('ai_provider_settings.clear', {
        provider: 'anthropic',
        actor: 'user-2',
      });
    });

    it('throws AiProviderSettingsNotApplicableError when active provider is fake', async () => {
      const service = buildService(buildConfigService({ OL_AI_PROVIDER: 'fake' }));

      await expect(service.clear()).rejects.toBeInstanceOf(
        AiProviderSettingsNotApplicableError,
      );
      expect(repository.delete).not.toHaveBeenCalled();
      expect(credentialsPort.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('aiProviderCredentialsRef', () => {
    it('builds a stable ref per provider', () => {
      expect(aiProviderCredentialsRef('anthropic')).toBe('ai-provider:anthropic');
      expect(aiProviderCredentialsRef('fake')).toBe('ai-provider:fake');
    });
  });

  describe('OL_AI_PROVIDER fallback', () => {
    it('treats an unknown OL_AI_PROVIDER value as anthropic (default)', async () => {
      const service = buildService(buildConfigService({ OL_AI_PROVIDER: 'gibberish' }));

      await service.set('sk-ant-test-12345678');

      expect(repository.update).toHaveBeenCalledWith('ai-provider:anthropic', expect.anything());
    });
  });
});
