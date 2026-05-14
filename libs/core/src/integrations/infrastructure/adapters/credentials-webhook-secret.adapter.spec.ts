/**
 * Credentials Webhook Secret Adapter Unit Tests
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 */
import type { ConfigService } from '@nestjs/config';
import { CredentialsWebhookSecretAdapter } from './credentials-webhook-secret.adapter';
import type { IntegrationCredentialRepositoryPort } from '../../domain/ports/integration-credential-repository.port';
import { CredentialNotFoundException } from '../../domain/exceptions/credential-not-found.exception';
import { IntegrationCredential } from '../../domain/entities/integration-credential.entity';

describe('CredentialsWebhookSecretAdapter', () => {
  const connectionId = 'c1';
  const provider = 'prestashop';
  let repository: jest.Mocked<IntegrationCredentialRepositoryPort>;
  let config: jest.Mocked<Pick<ConfigService, 'get'>>;
  let subject: CredentialsWebhookSecretAdapter;

  beforeEach(() => {
    repository = {
      getByRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    config = { get: jest.fn() } as never;
    subject = new CredentialsWebhookSecretAdapter(repository, config as unknown as ConfigService);
  });

  const credential = (webhookSecret: unknown): IntegrationCredential =>
    new IntegrationCredential(
      'id',
      `webhook-secret:${connectionId}`,
      provider,
      { webhookSecret },
      new Date(),
      new Date()
    );

  it('returns plaintext secret from DB', async () => {
    repository.getByRef.mockResolvedValue(credential('plain'));

    const secret = await subject.getSecret(provider, connectionId);

    expect(secret).toBe('plain');
    expect(repository.getByRef).toHaveBeenCalledWith(`webhook-secret:${connectionId}`);
  });

  it('returns null when webhookSecret field is missing', async () => {
    repository.getByRef.mockResolvedValue(credential(undefined));
    config.get.mockReturnValue(undefined);

    await expect(subject.getSecret(provider, connectionId)).rejects.toThrow(/not found/);
  });

  it('falls back to env with a deprecation warning on DB miss', async () => {
    repository.getByRef.mockRejectedValue(new CredentialNotFoundException('x'));
    config.get.mockImplementation((k: string) =>
      k === `OPENLINKER_WEBHOOK_SECRET__${provider.toUpperCase()}__${connectionId.toUpperCase()}`
        ? 'env-secret'
        : undefined
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
      Promise.resolve(
        new IntegrationCredential(
          'id',
          ref,
          provider,
          { webhookSecret: `plain-${ref}` },
          new Date(),
          new Date()
        )
      )
    );

    const a = await subject.getSecret(provider, 'A');
    const b = await subject.getSecret(provider, 'B');

    expect(a).toBe('plain-webhook-secret:A');
    expect(b).toBe('plain-webhook-secret:B');
    expect(a).not.toEqual(b);
  });

  it('caches resolved secrets and invalidate() clears them', async () => {
    repository.getByRef.mockResolvedValue(credential('plain'));

    await subject.getSecret(provider, connectionId);
    await subject.getSecret(provider, connectionId);
    expect(repository.getByRef).toHaveBeenCalledTimes(1);

    subject.invalidate(provider, connectionId);
    await subject.getSecret(provider, connectionId);
    expect(repository.getByRef).toHaveBeenCalledTimes(2);
  });
});
