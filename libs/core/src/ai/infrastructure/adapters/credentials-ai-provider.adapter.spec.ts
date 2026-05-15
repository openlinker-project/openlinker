/**
 * Credentials AI Provider Adapter — Unit Tests
 *
 * Mocks `ICredentialsService` (the cross-context CRUD seam over the credential
 * repository, #718) and `ConfigService`. The adapter sees plaintext domain
 * entities (encryption-at-rest lives in the repository layer, #709).
 * Asserts: per-provider DB hit (returns plaintext apiKey), DB miss → env
 * fallback (warns once per provider), both missing → AiProviderKeyMissingError,
 * per-provider cache hit, invalidate(provider) clears that provider's slot,
 * describe() reports the resolution source per provider, provider=fake
 * short-circuits without DB/env lookups, env reads go via ConfigService
 * (not process.env).
 *
 * @module libs/core/src/ai/infrastructure/adapters
 */
import type { ConfigService } from '@nestjs/config';
import { Logger as SharedLogger } from '@openlinker/shared/logging';
import type { ICredentialsService } from '@openlinker/core/integrations';
import { CredentialNotFoundException } from '@openlinker/core/integrations';
import { IntegrationCredential } from '@openlinker/core/integrations';
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

const dbCredential = (ref: string, apiKey: string): IntegrationCredential =>
  new IntegrationCredential('cred-id', ref, 'anthropic', { apiKey }, new Date(), new Date());

describe('CredentialsAiProviderAdapter', () => {
  let credentials: jest.Mocked<Pick<ICredentialsService, 'getByRef'>>;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    credentials = {
      getByRef: jest.fn(),
    };
    warnSpy = jest.spyOn(SharedLogger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  const buildAdapter = (
    config: Record<string, string | undefined> = {}
  ): CredentialsAiProviderAdapter =>
    new CredentialsAiProviderAdapter(
      credentials as unknown as ICredentialsService,
      buildConfigService(config)
    );

  describe('getApiKey', () => {
    it('returns the plaintext DB apiKey when present for the given provider', async () => {
      credentials.getByRef.mockResolvedValue(
        dbCredential('ai-provider:anthropic', 'plaintext-key')
      );

      const result = await buildAdapter().getApiKey('anthropic');

      expect(result).toBe('plaintext-key');
      expect(credentials.getByRef).toHaveBeenCalledWith('ai-provider:anthropic');
    });

    it('falls back to ConfigService env (with one-shot warning per provider) when no DB row', async () => {
      credentials.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
      const adapter = buildAdapter({
        ANTHROPIC_API_KEY: 'anthropic-env-key',
        OPENAI_API_KEY: 'openai-env-key',
      });

      const a1 = await adapter.getApiKey('anthropic');
      const a2 = await adapter.getApiKey('anthropic');
      expect(a1).toBe('anthropic-env-key');
      expect(a2).toBe('anthropic-env-key');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const firstWarn = String((warnSpy.mock.calls[0] as unknown as [unknown])[0] ?? '');
      expect(firstWarn).toContain('ANTHROPIC_API_KEY');
      expect(firstWarn).toContain('deprecated');

      const o1 = await adapter.getApiKey('openai');
      expect(o1).toBe('openai-env-key');
      expect(warnSpy).toHaveBeenCalledTimes(2);
      const secondWarn = String((warnSpy.mock.calls[1] as unknown as [unknown])[0] ?? '');
      expect(secondWarn).toContain('OPENAI_API_KEY');
    });

    it('throws AiProviderKeyMissingError when neither DB nor env has a key for that provider', async () => {
      credentials.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
      const adapter = buildAdapter();

      await expect(adapter.getApiKey('anthropic')).rejects.toBeInstanceOf(
        AiProviderKeyMissingError
      );
    });

    it('caches the resolved key per provider and avoids re-reading the DB on the next call', async () => {
      credentials.getByRef.mockResolvedValue(
        dbCredential('ai-provider:anthropic', 'plaintext-key')
      );
      const adapter = buildAdapter();

      await adapter.getApiKey('anthropic');
      await adapter.getApiKey('anthropic');

      expect(credentials.getByRef).toHaveBeenCalledTimes(1);
    });

    it('re-reads the DB for that provider after invalidate(provider)', async () => {
      credentials.getByRef.mockResolvedValue(
        dbCredential('ai-provider:anthropic', 'plaintext-key')
      );
      const adapter = buildAdapter();

      await adapter.getApiKey('anthropic');
      adapter.invalidate('anthropic');
      await adapter.getApiKey('anthropic');

      expect(credentials.getByRef).toHaveBeenCalledTimes(2);
    });

    it("keeps each provider's cache slot independent — invalidating openai does not bust anthropic", async () => {
      credentials.getByRef.mockImplementation((ref: string) => {
        if (ref === 'ai-provider:anthropic') {
          return Promise.resolve(dbCredential('ai-provider:anthropic', 'a-plain'));
        }
        return Promise.resolve(dbCredential('ai-provider:openai', 'o-plain'));
      });
      const adapter = buildAdapter();

      await adapter.getApiKey('anthropic');
      await adapter.getApiKey('openai');
      adapter.invalidate('openai');
      await adapter.getApiKey('anthropic'); // still cached
      await adapter.getApiKey('openai'); // re-read

      expect(credentials.getByRef).toHaveBeenCalledTimes(3);
    });

    it('throws AiProviderSettingsNotApplicableError immediately for provider=fake', async () => {
      const adapter = buildAdapter();

      await expect(adapter.getApiKey('fake')).rejects.toBeInstanceOf(
        AiProviderSettingsNotApplicableError
      );
      expect(credentials.getByRef).not.toHaveBeenCalled();
    });
  });

  describe('describe', () => {
    it('reports source=db when a DB row exists', async () => {
      credentials.getByRef.mockResolvedValue(
        dbCredential('ai-provider:anthropic', 'plaintext-key')
      );

      expect(await buildAdapter().describe('anthropic')).toEqual({
        provider: 'anthropic',
        configured: true,
        source: 'db',
      });
    });

    it('reports source=env when DB is empty and env is set', async () => {
      credentials.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));

      const view = await buildAdapter({ ANTHROPIC_API_KEY: 'env-key' }).describe('anthropic');

      expect(view).toEqual({ provider: 'anthropic', configured: true, source: 'env' });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('reports source=none when neither DB nor env is set', async () => {
      credentials.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));

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
      expect(credentials.getByRef).not.toHaveBeenCalled();
    });
  });

  describe('describeAll', () => {
    it('returns a row per value in AiProviderValues', async () => {
      credentials.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));

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
      credentials.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
      const config = buildConfigService({ ANTHROPIC_API_KEY: 'env-key' });
      const adapter = new CredentialsAiProviderAdapter(
        credentials as unknown as ICredentialsService,
        config
      );

      await adapter.getApiKey('anthropic');

      expect(config.get).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
    });
  });
});
