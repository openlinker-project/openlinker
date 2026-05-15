/**
 * AI Provider Key Service — Unit Tests
 *
 * Mocks the credentials port + `ICredentialsService` (the cross-context
 * CRUD seam over the credential repository, #718). Asserts: per-provider
 * upsert+create paths persist plaintext (the repo encrypts); clear deletes;
 * both invalidate the port for that provider only; rejecting writes for
 * providers that don't require a key.
 *
 * @module libs/core/src/ai/application/services
 */
import { Logger as SharedLogger } from '@openlinker/shared/logging';
import type { ICredentialsService } from '@openlinker/core/integrations';
import { CredentialNotFoundException } from '@openlinker/core/integrations';
import { IntegrationCredential } from '@openlinker/core/integrations';
import type { AiProviderCredentialsPort } from '../../domain/ports/ai-provider-credentials.port';
import { AiProviderSettingsNotApplicableError } from '../../domain/exceptions/ai-provider-settings-not-applicable.exception';
import { AiProviderKeyService } from './ai-provider-key.service';

const sampleCredential = (ref: string): IntegrationCredential =>
  new IntegrationCredential('cred-id', ref, 'anthropic', { apiKey: 'plain-key' }, new Date(), new Date());

describe('AiProviderKeyService', () => {
  let credentialsPort: jest.Mocked<AiProviderCredentialsPort>;
  let credentials: jest.Mocked<Pick<ICredentialsService, 'create' | 'update' | 'delete'>>;
  let logSpy: jest.SpyInstance;

  const buildService = (): AiProviderKeyService =>
    new AiProviderKeyService(credentialsPort, credentials as unknown as ICredentialsService);

  beforeEach(() => {
    credentialsPort = {
      getApiKey: jest.fn(),
      describe: jest.fn(),
      describeAll: jest.fn(),
      invalidate: jest.fn(),
    };
    credentials = {
      create: jest.fn().mockResolvedValue(sampleCredential('ai-provider:anthropic')),
      update: jest.fn().mockResolvedValue(sampleCredential('ai-provider:anthropic')),
      delete: jest.fn().mockResolvedValue(true),
    };
    logSpy = jest.spyOn(SharedLogger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('setKey', () => {
    it('updates the existing credential row with plaintext apiKey', async () => {
      await buildService().setKey('anthropic', 'plain-key', 'admin-1');

      expect(credentials.update).toHaveBeenCalledWith('ai-provider:anthropic', {
        credentialsJson: { apiKey: 'plain-key' },
      });
      expect(credentials.create).not.toHaveBeenCalled();
      expect(credentialsPort.invalidate).toHaveBeenCalledWith('anthropic');
    });

    it('creates the credential row when the update path reports not-found', async () => {
      credentials.update.mockRejectedValueOnce(new CredentialNotFoundException('x'));

      await buildService().setKey('openai', 'plain-key', 'admin-1');

      expect(credentials.create).toHaveBeenCalledWith({
        ref: 'ai-provider:openai',
        platformType: 'openai',
        credentialsJson: { apiKey: 'plain-key' },
      });
      expect(credentialsPort.invalidate).toHaveBeenCalledWith('openai');
    });

    it('rejects providers that do not require a key (e.g. fake)', async () => {
      await expect(buildService().setKey('fake', 'k')).rejects.toBeInstanceOf(
        AiProviderSettingsNotApplicableError
      );
      expect(credentials.update).not.toHaveBeenCalled();
      expect(credentials.create).not.toHaveBeenCalled();
    });

    it('logs a per-provider audit entry on success', async () => {
      await buildService().setKey('anthropic', 'plain-key', 'admin-1');

      const audit = logSpy.mock.calls.find(
        (call) => (call as unknown[])[0] === 'ai_provider.set_key'
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

      expect(credentials.delete).toHaveBeenCalledWith('ai-provider:anthropic');
      expect(credentialsPort.invalidate).toHaveBeenCalledWith('anthropic');
    });

    it('rejects providers that do not require a key', async () => {
      await expect(buildService().clearKey('fake')).rejects.toBeInstanceOf(
        AiProviderSettingsNotApplicableError
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
