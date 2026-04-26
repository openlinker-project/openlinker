/**
 * Credentials AI Provider Adapter — Unit Tests
 *
 * Mocks the credential repo, crypto service, and ConfigService. Asserts:
 * DB hit (decrypts), DB miss → env fallback (warns once), both missing →
 * AiProviderKeyMissingError, cache hit, invalidate() clears cache,
 * describe() reports the resolution source without leaking the key,
 * provider=fake short-circuits without DB/env lookups, env reads go via
 * ConfigService (not process.env).
 *
 * @module libs/core/src/ai/infrastructure/adapters
 */
import { Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@openlinker/shared';
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
    warnSpy = jest.spyOn(NestLogger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  const buildAdapter = (
    config: Record<string, string | undefined> = { OL_AI_PROVIDER: 'anthropic' },
  ): CredentialsAiProviderAdapter =>
    new CredentialsAiProviderAdapter(
      repository,
      crypto as unknown as CryptoService,
      buildConfigService(config),
    );

  describe('getApiKey', () => {
    it('returns the decrypted DB key when present', async () => {
      repository.getByRef.mockResolvedValue(dbCredential('ai-provider:anthropic', 'cipher'));
      crypto.decrypt.mockReturnValue('plaintext-key');

      const result = await buildAdapter().getApiKey();

      expect(result).toBe('plaintext-key');
      expect(repository.getByRef).toHaveBeenCalledWith('ai-provider:anthropic');
      expect(crypto.decrypt).toHaveBeenCalledWith('cipher');
    });

    it('falls back to ConfigService env (with one-shot warning) when no DB row', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
      const adapter = buildAdapter({
        OL_AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'env-key',
      });

      const first = await adapter.getApiKey();
      const second = await adapter.getApiKey();

      expect(first).toBe('env-key');
      expect(second).toBe('env-key');
      expect(warnSpy).toHaveBeenCalledTimes(1); // one-shot
      const warnArgs = warnSpy.mock.calls[0] as unknown as [unknown, ...unknown[]];
      const warnedMessage = String(warnArgs[0] ?? '');
      expect(warnedMessage).toContain('ANTHROPIC_API_KEY');
      expect(warnedMessage).toContain('deprecated');
    });

    it('throws AiProviderKeyMissingError when neither DB nor env has a key', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
      const adapter = buildAdapter({ OL_AI_PROVIDER: 'anthropic' });

      await expect(adapter.getApiKey()).rejects.toBeInstanceOf(AiProviderKeyMissingError);
    });

    it('caches the resolved key and avoids re-reading the DB on the next call', async () => {
      repository.getByRef.mockResolvedValue(dbCredential('ai-provider:anthropic', 'cipher'));
      crypto.decrypt.mockReturnValue('plaintext-key');
      const adapter = buildAdapter();

      await adapter.getApiKey();
      await adapter.getApiKey();

      expect(repository.getByRef).toHaveBeenCalledTimes(1);
      expect(crypto.decrypt).toHaveBeenCalledTimes(1);
    });

    it('re-reads the DB after invalidate()', async () => {
      repository.getByRef.mockResolvedValue(dbCredential('ai-provider:anthropic', 'cipher'));
      crypto.decrypt.mockReturnValue('plaintext-key');
      const adapter = buildAdapter();

      await adapter.getApiKey();
      adapter.invalidate();
      await adapter.getApiKey();

      expect(repository.getByRef).toHaveBeenCalledTimes(2);
    });

    it('throws AiProviderSettingsNotApplicableError immediately when active provider is fake', async () => {
      const adapter = buildAdapter({ OL_AI_PROVIDER: 'fake' });

      await expect(adapter.getApiKey()).rejects.toBeInstanceOf(
        AiProviderSettingsNotApplicableError,
      );
      expect(repository.getByRef).not.toHaveBeenCalled();
    });

    it('treats a stored unencrypted credential as raw plaintext (does not call decrypt)', async () => {
      repository.getByRef.mockResolvedValue(
        dbCredential('ai-provider:anthropic', 'plaintext-stored', false),
      );

      const result = await buildAdapter().getApiKey();

      expect(result).toBe('plaintext-stored');
      expect(crypto.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('describe', () => {
    it('reports source=db when a DB row exists', async () => {
      repository.getByRef.mockResolvedValue(dbCredential('ai-provider:anthropic', 'cipher'));
      crypto.decrypt.mockReturnValue('plaintext-key');

      expect(await buildAdapter().describe()).toEqual({
        provider: 'anthropic',
        configured: true,
        source: 'db',
      });
    });

    it('reports source=env when DB is empty and env is set', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));

      const view = await buildAdapter({
        OL_AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'env-key',
      }).describe();

      expect(view).toEqual({
        provider: 'anthropic',
        configured: true,
        source: 'env',
      });
      // describe() must not emit the deprecation warning — only getApiKey() does
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('reports source=none when neither DB nor env is set', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));

      expect(await buildAdapter({ OL_AI_PROVIDER: 'anthropic' }).describe()).toEqual({
        provider: 'anthropic',
        configured: false,
        source: 'none',
      });
    });

    it('short-circuits to source=none for provider=fake without any DB/env lookup', async () => {
      const adapter = buildAdapter({ OL_AI_PROVIDER: 'fake' });

      const view = await adapter.describe();

      expect(view).toEqual({ provider: 'fake', configured: false, source: 'none' });
      expect(repository.getByRef).not.toHaveBeenCalled();
    });
  });

  describe('env reads use ConfigService, not process.env', () => {
    it('routes the env lookup through ConfigService.get', async () => {
      repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
      const config = buildConfigService({
        OL_AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'env-key',
      });
      const adapter = new CredentialsAiProviderAdapter(
        repository,
        crypto as unknown as CryptoService,
        config,
      );

      await adapter.getApiKey();

      expect(config.get).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
    });
  });
});
