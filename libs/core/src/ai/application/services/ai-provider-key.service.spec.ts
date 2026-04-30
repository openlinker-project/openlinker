/**
 * AI Provider Key Service — Unit Tests
 *
 * Mocks the credentials port + credential repo + crypto. Asserts: per-provider
 * upsert+create paths encrypt and persist; clear deletes; both invalidate the
 * port for that provider only; rejecting writes for providers that don't
 * require a key.
 *
 * @module libs/core/src/ai/application/services
 */
import { Logger as NestLogger } from '@nestjs/common';
import { CryptoService } from '@openlinker/shared';
import {
  IntegrationCredentialRepositoryPort,
  CredentialNotFoundException,
} from '@openlinker/core/integrations';
import { IntegrationCredential } from '@openlinker/core/integrations/domain/entities/integration-credential.entity';
import { AiProviderCredentialsPort } from '../../domain/ports/ai-provider-credentials.port';
import { AiProviderSettingsNotApplicableError } from '../../domain/exceptions/ai-provider-settings-not-applicable.exception';
import { AiProviderKeyService } from './ai-provider-key.service';

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

describe('AiProviderKeyService', () => {
  let credentialsPort: jest.Mocked<AiProviderCredentialsPort>;
  let repository: jest.Mocked<IntegrationCredentialRepositoryPort>;
  let crypto: jest.Mocked<Pick<CryptoService, 'encrypt' | 'decrypt'>>;
  let logSpy: jest.SpyInstance;

  const buildService = (): AiProviderKeyService =>
    new AiProviderKeyService(credentialsPort, repository, crypto as unknown as CryptoService);

  beforeEach(() => {
    credentialsPort = {
      getApiKey: jest.fn(),
      describe: jest.fn(),
      describeAll: jest.fn(),
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

  describe('setKey', () => {
    it('encrypts the key and updates the existing credential row when present', async () => {
      await buildService().setKey('anthropic', 'plain-key', 'admin-1');

      expect(crypto.encrypt).toHaveBeenCalledWith('plain-key');
      expect(repository.update).toHaveBeenCalledWith('ai-provider:anthropic', {
        credentialsJson: { ciphertext: 'cipher' },
        encrypted: true,
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(credentialsPort.invalidate).toHaveBeenCalledWith('anthropic');
    });

    it('creates the credential row when the update path reports not-found', async () => {
      repository.update.mockRejectedValueOnce(new CredentialNotFoundException('x'));

      await buildService().setKey('openai', 'plain-key', 'admin-1');

      expect(repository.create).toHaveBeenCalledWith({
        ref: 'ai-provider:openai',
        platformType: 'openai',
        credentialsJson: { ciphertext: 'cipher' },
        encrypted: true,
      });
      expect(credentialsPort.invalidate).toHaveBeenCalledWith('openai');
    });

    it('rejects providers that do not require a key (e.g. fake)', async () => {
      await expect(buildService().setKey('fake', 'k')).rejects.toBeInstanceOf(
        AiProviderSettingsNotApplicableError,
      );
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('logs a per-provider audit entry on success', async () => {
      await buildService().setKey('anthropic', 'plain-key', 'admin-1');

      const audit = logSpy.mock.calls.find(
        (call) => (call as unknown[])[0] === 'ai_provider.set_key',
      );
      expect(audit).toBeDefined();
      expect((audit as unknown as [string, Record<string, unknown>])[1]).toEqual({
        provider: 'anthropic',
        actor: 'admin-1',
      });
    });
  });

  describe('clearKey', () => {
    it('deletes the credential row and invalidates the per-provider cache', async () => {
      await buildService().clearKey('anthropic', 'admin-1');

      expect(repository.delete).toHaveBeenCalledWith('ai-provider:anthropic');
      expect(credentialsPort.invalidate).toHaveBeenCalledWith('anthropic');
    });

    it('rejects providers that do not require a key', async () => {
      await expect(buildService().clearKey('fake')).rejects.toBeInstanceOf(
        AiProviderSettingsNotApplicableError,
      );
    });
  });

  describe('describe / describeAll', () => {
    it('delegates per-provider status reads to the credentials port', async () => {
      credentialsPort.describe.mockResolvedValue({
        provider: 'anthropic',
        configured: true,
        source: 'db',
      });
      const result = await buildService().describe('anthropic');
      expect(credentialsPort.describe).toHaveBeenCalledWith('anthropic');
      expect(result).toEqual({ provider: 'anthropic', configured: true, source: 'db' });
    });

    it('delegates the bulk read to credentialsPort.describeAll()', async () => {
      const expected = [
        { provider: 'anthropic' as const, configured: true, source: 'db' as const },
      ];
      credentialsPort.describeAll.mockResolvedValue(expected);
      const result = await buildService().describeAll();
      expect(credentialsPort.describeAll).toHaveBeenCalled();
      expect(result).toBe(expected);
    });
  });
});
