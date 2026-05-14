/**
 * Integration Credential Repository — Unit Tests
 *
 * Pins the encryption boundary: `toOrm` writes ciphertext into
 * `credentialsCiphertext`, `toDomain` round-trips through
 * `crypto.decrypt + JSON.parse`. Mocks the TypeORM repository so the spec
 * is fast and independent of Postgres — the int-spec
 * `ai-provider-settings.int-spec.ts` and `connection-credentials.int-spec.ts`
 * cover the real-DB round-trip.
 *
 * @module libs/core/src/integrations/infrastructure/persistence/repositories
 */
import type { Repository } from 'typeorm';
import type { CryptoService } from '@openlinker/shared';
import { IntegrationCredentialRepository } from './integration-credential.repository';
import type { IntegrationCredentialOrmEntity } from '../entities/integration-credential.orm-entity';
import { CredentialNotFoundException } from '../../../domain/exceptions/credential-not-found.exception';

describe('IntegrationCredentialRepository', () => {
  let ormRepo: jest.Mocked<Pick<Repository<IntegrationCredentialOrmEntity>, 'findOne' | 'save' | 'delete'>>;
  let crypto: jest.Mocked<Pick<CryptoService, 'encrypt' | 'decrypt'>>;
  let subject: IntegrationCredentialRepository;

  beforeEach(() => {
    ormRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    crypto = {
      encrypt: jest.fn().mockImplementation((p: string) => `cipher(${p})`),
      decrypt: jest.fn().mockImplementation((c: string) => c.replace(/^cipher\((.+)\)$/, '$1')),
    };
    subject = new IntegrationCredentialRepository(
      ormRepo as unknown as Repository<IntegrationCredentialOrmEntity>,
      crypto as unknown as CryptoService,
    );
  });

  const ormRow = (overrides: Partial<IntegrationCredentialOrmEntity> = {}): IntegrationCredentialOrmEntity => ({
    id: 'cred-1',
    ref: 'webhook-secret:c1',
    platformType: 'prestashop',
    credentialsCiphertext: 'cipher({"webhookSecret":"plain"})',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('create', () => {
    it('encrypts JSON.stringify(credentialsJson) into credentialsCiphertext', async () => {
      ormRepo.save.mockImplementation((entity) =>
        Promise.resolve({ ...ormRow(), ...(entity as IntegrationCredentialOrmEntity) }),
      );

      await subject.create({
        ref: 'ai-provider:openai',
        platformType: 'openai',
        credentialsJson: { apiKey: 'plain-key' },
      });

      expect(crypto.encrypt).toHaveBeenCalledWith(JSON.stringify({ apiKey: 'plain-key' }));
      const saved = ormRepo.save.mock.calls[0][0] as IntegrationCredentialOrmEntity;
      expect(saved.credentialsCiphertext).toBe('cipher({"apiKey":"plain-key"})');
    });

    it('returns a decrypted domain entity', async () => {
      ormRepo.save.mockResolvedValue(ormRow({ credentialsCiphertext: 'cipher({"apiKey":"k"})' }));

      const created = await subject.create({
        ref: 'ai-provider:openai',
        platformType: 'openai',
        credentialsJson: { apiKey: 'k' },
      });

      expect(created.credentialsJson).toEqual({ apiKey: 'k' });
    });
  });

  describe('getByRef', () => {
    it('round-trips via crypto.decrypt + JSON.parse', async () => {
      ormRepo.findOne.mockResolvedValue(
        ormRow({ credentialsCiphertext: 'cipher({"webhookSecret":"plain"})' }),
      );

      const credential = await subject.getByRef('webhook-secret:c1');

      expect(crypto.decrypt).toHaveBeenCalledWith('cipher({"webhookSecret":"plain"})');
      expect(credential.credentialsJson).toEqual({ webhookSecret: 'plain' });
    });

    it('throws CredentialNotFoundException when missing', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      await expect(subject.getByRef('nope')).rejects.toBeInstanceOf(CredentialNotFoundException);
    });
  });

  describe('update', () => {
    it('re-encrypts the patched JSON when credentialsJson is provided', async () => {
      const existing = ormRow();
      ormRepo.findOne.mockResolvedValue(existing);
      ormRepo.save.mockImplementation((entity) =>
        Promise.resolve(entity as IntegrationCredentialOrmEntity),
      );

      await subject.update('webhook-secret:c1', {
        credentialsJson: { webhookSecret: 'rotated' },
      });

      expect(crypto.encrypt).toHaveBeenCalledWith(JSON.stringify({ webhookSecret: 'rotated' }));
      expect(existing.credentialsCiphertext).toBe('cipher({"webhookSecret":"rotated"})');
    });

    it('throws CredentialNotFoundException when ref is unknown', async () => {
      ormRepo.findOne.mockResolvedValue(null);
      await expect(subject.update('nope', { credentialsJson: {} })).rejects.toBeInstanceOf(
        CredentialNotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('returns true when a row was affected', async () => {
      ormRepo.delete.mockResolvedValue({ affected: 1, raw: [] });
      expect(await subject.delete('r')).toBe(true);
    });

    it('returns false when no row matched', async () => {
      ormRepo.delete.mockResolvedValue({ affected: 0, raw: [] });
      expect(await subject.delete('r')).toBe(false);
    });
  });
});
