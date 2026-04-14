/**
 * Credentials Webhook Secret Adapter Unit Tests
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 */
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '@openlinker/shared';
import { CredentialsWebhookSecretAdapter } from './credentials-webhook-secret.adapter';
import { IntegrationCredentialRepositoryPort } from '../../domain/ports/integration-credential-repository.port';
import { CredentialNotFoundException } from '../../domain/exceptions/credential-not-found.exception';
import { IntegrationCredential } from '../../domain/entities/integration-credential.entity';

describe('CredentialsWebhookSecretAdapter', () => {
  const connectionId = 'c1';
  const provider = 'prestashop';
  let repository: jest.Mocked<IntegrationCredentialRepositoryPort>;
  let config: jest.Mocked<Pick<ConfigService, 'get'>>;
  let crypto: jest.Mocked<Pick<CryptoService, 'encrypt' | 'decrypt'>>;
  let subject: CredentialsWebhookSecretAdapter;

  beforeEach(() => {
    repository = {
      getByRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    config = { get: jest.fn() } as never;
    crypto = { encrypt: jest.fn(), decrypt: jest.fn() } as never;
    subject = new CredentialsWebhookSecretAdapter(
      repository,
      crypto as unknown as CryptoService,
      config as unknown as ConfigService,
    );
  });

  const credential = (ciphertext: unknown, encrypted = true): IntegrationCredential =>
    new IntegrationCredential(
      'id',
      `webhook-secret:${connectionId}`,
      provider,
      { ciphertext },
      encrypted,
      new Date(),
      new Date(),
    );

  it('returns decrypted secret from DB', async () => {
    repository.getByRef.mockResolvedValue(credential('ENV'));
    crypto.decrypt.mockReturnValue('plain');

    const secret = await subject.getSecret(provider, connectionId);

    expect(secret).toBe('plain');
    expect(repository.getByRef).toHaveBeenCalledWith(`webhook-secret:${connectionId}`);
    expect(crypto.decrypt).toHaveBeenCalledWith('ENV');
  });

  it('returns raw ciphertext when credential.encrypted is false', async () => {
    repository.getByRef.mockResolvedValue(credential('raw-value', false));

    const secret = await subject.getSecret(provider, connectionId);

    expect(secret).toBe('raw-value');
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it('falls back to env with a deprecation warning on DB miss', async () => {
    repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
    config.get.mockImplementation((k: string) =>
      k === `OPENLINKER_WEBHOOK_SECRET__${provider.toUpperCase()}__${connectionId.toUpperCase()}`
        ? 'env-secret'
        : undefined,
    );

    const secret = await subject.getSecret(provider, connectionId);

    expect(secret).toBe('env-secret');
  });

  it('emits env deprecation warning only once per key', async () => {
    repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
    config.get.mockReturnValue('env-secret');
    const warnSpy = jest.spyOn(subject['logger'], 'warn');

    await subject.getSecret(provider, connectionId);
    await subject.getSecret(provider, connectionId); // second call hits cache, no warn
    subject.invalidate(provider, connectionId);
    await subject.getSecret(provider, connectionId); // cache miss but key already warned

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('throws when neither DB nor env resolve', async () => {
    repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
    config.get.mockReturnValue(undefined);

    await expect(subject.getSecret(provider, connectionId)).rejects.toThrow(/not found/);
  });

  it('resolves distinct secrets per connection', async () => {
    repository.getByRef.mockImplementation((ref: string) =>
      Promise.resolve(credential(`cipher-${ref}`)),
    );
    crypto.decrypt.mockImplementation((c: string) => `plain-${c}`);

    const a = await subject.getSecret(provider, 'A');
    const b = await subject.getSecret(provider, 'B');

    expect(a).toBe('plain-cipher-webhook-secret:A');
    expect(b).toBe('plain-cipher-webhook-secret:B');
    expect(a).not.toEqual(b);
  });

  it('caches resolved secrets and invalidate() clears them', async () => {
    repository.getByRef.mockResolvedValue(credential('ENV'));
    crypto.decrypt.mockReturnValue('plain');

    await subject.getSecret(provider, connectionId);
    await subject.getSecret(provider, connectionId);
    expect(repository.getByRef).toHaveBeenCalledTimes(1);

    subject.invalidate(provider, connectionId);
    await subject.getSecret(provider, connectionId);
    expect(repository.getByRef).toHaveBeenCalledTimes(2);
  });
});
