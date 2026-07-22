/**
 * Webhook Secret Service Unit Tests
 *
 * @module libs/core/src/integrations/application/services
 */
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { Connection } from '@openlinker/core/identifier-mapping';
import { WebhookSecretService } from './webhook-secret.service';
import type { IntegrationCredentialRepositoryPort } from '../../domain/ports/integration-credential-repository.port';
import type { WebhookSecretProviderPort } from '../../domain/ports/webhook-secret-provider.port';
import { CredentialNotFoundException } from '../../domain/exceptions/credential-not-found.exception';
import { IntegrationCredential } from '../../domain/entities/integration-credential.entity';

describe('WebhookSecretService', () => {
  const connectionId = 'conn-1';
  const connection = new Connection(
    connectionId,
    'prestashop',
    'n',
    'active',
    {},
    'r',
    new Date(),
    new Date(),
    'prestashop.webservice.v1',
    []
  );

  let connectionPort: jest.Mocked<ConnectionPort>;
  let repository: jest.Mocked<IntegrationCredentialRepositoryPort>;
  let secretProvider: jest.Mocked<WebhookSecretProviderPort>;
  let subject: WebhookSecretService;

  const sampleCredential = new IntegrationCredential(
    'id',
    `webhook-secret:${connectionId}`,
    'prestashop',
    {},
    new Date(),
    new Date()
  );

  beforeEach(() => {
    connectionPort = { get: jest.fn().mockResolvedValue(connection) } as never;
    repository = {
      getByRef: jest.fn(),
      create: jest.fn().mockResolvedValue(sampleCredential),
      update: jest.fn().mockResolvedValue(sampleCredential),
      delete: jest.fn(),
    };
    secretProvider = { getSecret: jest.fn(), invalidate: jest.fn() } as never;

    subject = new WebhookSecretService(connectionPort, repository, secretProvider);
  });

  it('updates existing credential with plaintext secret and returns it once', async () => {
    const result = await subject.rotate('prestashop', connectionId, 'user-1');

    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(repository.update).toHaveBeenCalledWith(`webhook-secret:${connectionId}`, {
      credentialsJson: { webhookSecret: result.secret },
    });
    expect(secretProvider.invalidate).toHaveBeenCalledWith('prestashop', connectionId);
  });

  it('creates the credential when missing', async () => {
    repository.update.mockRejectedValueOnce(new CredentialNotFoundException('x'));

    const result = await subject.rotate('prestashop', connectionId);

    expect(repository.create).toHaveBeenCalledWith({
      ref: `webhook-secret:${connectionId}`,
      platformType: 'prestashop',
      credentialsJson: { webhookSecret: result.secret },
    });
  });

  it('propagates connection lookup failures', async () => {
    connectionPort.get.mockRejectedValue(new Error('nope'));

    await expect(subject.rotate('prestashop', connectionId)).rejects.toThrow('nope');
    expect(repository.update).not.toHaveBeenCalled();
  });

  describe('set', () => {
    it('persists the caller-supplied secret and invalidates the cache', async () => {
      await subject.set('prestashop', connectionId, 'pasted-secret', 'user-1');

      expect(repository.update).toHaveBeenCalledWith(`webhook-secret:${connectionId}`, {
        credentialsJson: { webhookSecret: 'pasted-secret' },
      });
      expect(secretProvider.invalidate).toHaveBeenCalledWith('prestashop', connectionId);
    });

    it('creates the credential when missing', async () => {
      repository.update.mockRejectedValueOnce(new CredentialNotFoundException('x'));

      await subject.set('prestashop', connectionId, 'pasted-secret');

      expect(repository.create).toHaveBeenCalledWith({
        ref: `webhook-secret:${connectionId}`,
        platformType: 'prestashop',
        credentialsJson: { webhookSecret: 'pasted-secret' },
      });
    });

    it('propagates connection lookup failures without writing', async () => {
      connectionPort.get.mockRejectedValue(new Error('nope'));

      await expect(subject.set('prestashop', connectionId, 's')).rejects.toThrow('nope');
      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
