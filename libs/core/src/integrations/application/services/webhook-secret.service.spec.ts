/**
 * Webhook Secret Service Unit Tests
 *
 * @module libs/core/src/integrations/application/services
 */
import { CryptoService } from '@openlinker/shared';
import { ConnectionPort, Connection } from '@openlinker/core/identifier-mapping';
import { WebhookSecretService } from './webhook-secret.service';
import { IntegrationCredentialRepositoryPort } from '../../domain/ports/integration-credential-repository.port';
import { WebhookSecretProviderPort } from '../../domain/ports/webhook-secret-provider.port';
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
    [],
  );

  let connectionPort: jest.Mocked<ConnectionPort>;
  let repository: jest.Mocked<IntegrationCredentialRepositoryPort>;
  let crypto: jest.Mocked<Pick<CryptoService, 'encrypt' | 'decrypt'>>;
  let secretProvider: jest.Mocked<WebhookSecretProviderPort>;
  let subject: WebhookSecretService;

  const sampleCredential = new IntegrationCredential(
    'id',
    `webhook-secret:${connectionId}`,
    'prestashop',
    {},
    true,
    new Date(),
    new Date(),
  );

  beforeEach(() => {
    connectionPort = { get: jest.fn().mockResolvedValue(connection) } as never;
    repository = {
      getByRef: jest.fn(),
      create: jest.fn().mockResolvedValue(sampleCredential),
      update: jest.fn().mockResolvedValue(sampleCredential),
      delete: jest.fn(),
    };
    crypto = { encrypt: jest.fn().mockReturnValue('cipher'), decrypt: jest.fn() } as never;
    secretProvider = { getSecret: jest.fn(), invalidate: jest.fn() } as never;

    subject = new WebhookSecretService(
      connectionPort,
      repository,
      crypto as unknown as CryptoService,
      secretProvider,
    );
  });

  it('updates existing credential when present and returns plaintext once', async () => {
    const result = await subject.rotate('prestashop', connectionId, 'user-1');

    expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.encrypt).toHaveBeenCalledWith(result.secret);
    expect(repository.update).toHaveBeenCalledWith(
      `webhook-secret:${connectionId}`,
      { credentialsJson: { ciphertext: 'cipher' }, encrypted: true },
    );
    expect(secretProvider.invalidate).toHaveBeenCalledWith('prestashop', connectionId);
  });

  it('creates the credential when missing', async () => {
    repository.update.mockRejectedValueOnce(new CredentialNotFoundException('x'));

    await subject.rotate('prestashop', connectionId);

    expect(repository.create).toHaveBeenCalledWith({
      ref: `webhook-secret:${connectionId}`,
      platformType: 'prestashop',
      credentialsJson: { ciphertext: 'cipher' },
      encrypted: true,
    });
  });

  it('propagates connection lookup failures', async () => {
    connectionPort.get.mockRejectedValue(new Error('nope'));

    await expect(subject.rotate('prestashop', connectionId)).rejects.toThrow('nope');
    expect(repository.update).not.toHaveBeenCalled();
  });
});
