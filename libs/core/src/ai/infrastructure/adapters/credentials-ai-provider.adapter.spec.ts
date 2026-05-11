/**
 * Credentials AI Provider Adapter — Unit Tests
 *
 * Mocks the credential repo, crypto service, and ConfigService. Asserts:
 * per-provider DB hit (decrypts), DB miss → env fallback (warns once per
 * provider), both missing → AiProviderKeyMissingError, per-provider cache
 * hit, invalidate(provider) clears that provider's slot, describe() reports
 * the resolution source per provider, provider=fake short-circuits without
 * DB/env lookups, env reads go via ConfigService (not process.env).
 *
 * @module libs/core/src/ai/infrastructure/adapters
 */
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@openlinker/shared';
import { Logger as SharedLogger } from '@openlinker/shared/logging';
import {
  IntegrationCredentialRepositoryPort,
  CredentialNotFoundException,
} from '@openlinker/core/integrations';
import { IntegrationCredential } from '@openlinker/core/integrations/domain/entities/integration-credential.entity';
import { AiProviderKeyMissingError } from '../../domain/exceptions/ai-provider-key-missing.exception';
import { AiProviderSettingsNotApplicableError } from '../../domain/exceptions/ai-provider-settings-not-applicable.exception';
import { CredentialsAiProviderAdapter } from './credentials-ai-provider.adapter';

const buildConfigService = (overrides: Record<string, string | undefined>): ConfigService =>
  ({
    get: jest.fn(<T = string>(key: string, defaultValue?: T): T => {
      const v = overrides[key];
      return (v ?? defaultValue) as T;
    }),
  }) as unknown as ConfigService;

const dbCredential = (ref: string, ciphertext: string, encrypted = true): IntegrationCredential =>
  new IntegrationCredential(
    'cred-id',
    ref,
    'anthropic',
    { ciphertext },
    encrypted,
    new Date(),
    new Date(),
  );

describe('CredentialsAiProviderAdapter', () => {
  let repository: jest.Mocked<IntegrationCredentialRepositoryPort>;
  let crypto: jest.Mocked<Pick<CryptoService, 'encrypt' | 'decrypt'>>;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    repository = {
      getByRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    crypto = {
      encrypt: jest.fn(),
      decrypt: jest.fn(),
    };
    warnSpy = jest.spyOn(SharedLogger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  const buildAdapter = (
    config: Record<string, string | undefined> = {},
  ): CredentialsAiProviderAdapter =>
    new CredentialsAiProviderAdapter(
      repository,
      crypto as unknown as CryptoService,
      buildConfigService(config),
    );

  describe('getApiKey', () => {
    it('returns the decrypted DB key when present for the given provider', async () => {
      repository.getByRef.mockResolvedValue(dbCredential('ai-provider:anthropic', 'cipher'));
      crypto.decrypt.mockReturnValue('plaintext-key');

      const result = await buildAdapter().getApiKey('anthropic');

      expect(result).toBe('plaintext-key');
      expect(repository.getByRef).toHaveBeenCalledWith('ai-provider:anthropic');
      expect(crypto.decrypt).toHaveBeenCalledWith('cipher');
    });

    it('falls back to ConfigService env (with one-shot warning per provider) when no DB row', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
      const adapter = buildAdapter({
        ANTHROPIC_API_KEY: 'anthropic-env-key',
        OPENAI_API_KEY: 'openai-env-key',
      });

      const a1 = await adapter.getApiKey('anthropic');
      const a2 = await adapter.getApiKey('anthropic');
      expect(a1).toBe('anthropic-env-key');
      expect(a2).toBe('anthropic-env-key');
      // Only one warning emitted for anthropic so far
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstWarn = String((warnSpy.mock.calls[0] as unknown as [unknown])[0] ?? '');
      expect(firstWarn).toContain('ANTHROPIC_API_KEY');
      expect(firstWarn).toContain('deprecated');

      // OpenAI key resolves separately and triggers its own one-shot warning
      const o1 = await adapter.getApiKey('openai');
      expect(o1).toBe('openai-env-key');
      expect(warnSpy).toHaveBeenCalledTimes(2);
      const secondWarn = String((warnSpy.mock.calls[1] as unknown as [unknown])[0] ?? '');
      expect(secondWarn).toContain('OPENAI_API_KEY');
    });

    it('throws AiProviderKeyMissingError when neither DB nor env has a key for that provider', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
      const adapter = buildAdapter();

      await expect(adapter.getApiKey('anthropic')).rejects.toBeInstanceOf(AiProviderKeyMissingError);
    });

    it('caches the resolved key per provider and avoids re-reading the DB on the next call', async () => {
      repository.getByRef.mockResolvedValue(dbCredential('ai-provider:anthropic', 'cipher'));
      crypto.decrypt.mockReturnValue('plaintext-key');
      const adapter = buildAdapter();

      await adapter.getApiKey('anthropic');
      await adapter.getApiKey('anthropic');

      expect(repository.getByRef).toHaveBeenCalledTimes(1);
      expect(crypto.decrypt).toHaveBeenCalledTimes(1);
    });

    it('re-reads the DB for that provider after invalidate(provider)', async () => {
      repository.getByRef.mockResolvedValue(dbCredential('ai-provider:anthropic', 'cipher'));
      crypto.decrypt.mockReturnValue('plaintext-key');
      const adapter = buildAdapter();

      await adapter.getApiKey('anthropic');
      adapter.invalidate('anthropic');
      await adapter.getApiKey('anthropic');

      expect(repository.getByRef).toHaveBeenCalledTimes(2);
    });

    it('keeps each provider\'s cache slot independent — invalidating openai does not bust anthropic', async () => {
      repository.getByRef.mockImplementation((ref: string) => {
        if (ref === 'ai-provider:anthropic') {
          return Promise.resolve(dbCredential('ai-provider:anthropic', 'a-cipher'));
        }
        return Promise.resolve(dbCredential('ai-provider:openai', 'o-cipher'));
      });
      crypto.decrypt.mockImplementation((ct: string) => `plain-${ct}`);
      const adapter = buildAdapter();

      await adapter.getApiKey('anthropic');
      await adapter.getApiKey('openai');
      adapter.invalidate('openai');
      await adapter.getApiKey('anthropic'); // still cached
      await adapter.getApiKey('openai'); // re-read

      expect(repository.getByRef).toHaveBeenCalledTimes(3);
    });

    it('throws AiProviderSettingsNotApplicableError immediately for provider=fake', async () => {
      const adapter = buildAdapter();

      await expect(adapter.getApiKey('fake')).rejects.toBeInstanceOf(
        AiProviderSettingsNotApplicableError,
      );
      expect(repository.getByRef).not.toHaveBeenCalled();
    });

    it('treats a stored unencrypted credential as raw plaintext (does not call decrypt)', async () => {
      repository.getByRef.mockResolvedValue(
        dbCredential('ai-provider:anthropic', 'plaintext-stored', false),
      );

      const result = await buildAdapter().getApiKey('anthropic');

      expect(result).toBe('plaintext-stored');
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('describe', () => {
    it('reports source=db when a DB row exists', async () => {
      repository.getByRef.mockResolvedValue(dbCredential('ai-provider:anthropic', 'cipher'));
      crypto.decrypt.mockReturnValue('plaintext-key');

      expect(await buildAdapter().describe('anthropic')).toEqual({
        provider: 'anthropic',
        configured: true,
        source: 'db',
      });
    });

    it('reports source=env when DB is empty and env is set', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));

      const view = await buildAdapter({ ANTHROPIC_API_KEY: 'env-key' }).describe('anthropic');

      expect(view).toEqual({ provider: 'anthropic', configured: true, source: 'env' });
      // describe() must not emit the deprecation warning — only getApiKey() does
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('reports source=none when neither DB nor env is set', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));

      expect(await buildAdapter().describe('anthropic')).toEqual({
        provider: 'anthropic',
        configured: false,
        source: 'none',
      });
    });

    it('short-circuits to source=none for provider=fake without any DB/env lookup', async () => {
      const adapter = buildAdapter();

      const view = await adapter.describe('fake');

      expect(view).toEqual({ provider: 'fake', configured: false, source: 'none' });
      expect(repository.getByRef).not.toHaveBeenCalled();
    });
  });

  describe('describeAll', () => {
    it('returns a row per value in AiProviderValues', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));

      const views = await buildAdapter().describeAll();

      expect(views.map((v) => v.provider)).toEqual(['anthropic', 'openai', 'fake']);
      expect(views.find((v) => v.provider === 'fake')).toEqual({
        provider: 'fake',
        configured: false,
        source: 'none',
      });
    });
  });

  describe('env reads use ConfigService, not process.env', () => {
    it('routes the env lookup through ConfigService.get', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
      const config = buildConfigService({ ANTHROPIC_API_KEY: 'env-key' });
      const adapter = new CredentialsAiProviderAdapter(
        repository,
        crypto as unknown as CryptoService,
        config,
      );

      await adapter.getApiKey('anthropic');

      expect(config.get).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
    });
  });
});
