/**
 * Credentials Service Tests
 *
 * Exercises the four pass-through methods. No domain logic to verify beyond
 * forwarding arguments to the repository and returning its result verbatim.
 *
 * @module libs/core/src/integrations/application/services
 */
import type { IntegrationCredential } from '../../domain/entities/integration-credential.entity';
import type { IntegrationCredentialRepositoryPort } from '../../domain/ports/integration-credential-repository.port';
import { CredentialNotFoundException } from '../../domain/exceptions/credential-not-found.exception';
import { CredentialsService } from './credentials.service';

function buildRepoMock(): jest.Mocked<IntegrationCredentialRepositoryPort> {
  return {
    getByRef: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

const sampleCredential = {
  id: 'cred-1',
  ref: 'ai-provider:anthropic',
  platformType: 'anthropic',
  credentialsJson: { apiKey: 'plain' },
  createdAt: new Date('2026-05-15T00:00:00.000Z'),
  updatedAt: new Date('2026-05-15T00:00:00.000Z'),
} as unknown as IntegrationCredential;

describe('CredentialsService', () => {
  describe('getByRef', () => {
    it('forwards ref to repository.getByRef and returns the credential verbatim', async () => {
      const repo = buildRepoMock();
      repo.getByRef.mockResolvedValue(sampleCredential);
      const service = new CredentialsService(repo);

      const result = await service.getByRef('ai-provider:anthropic');

      expect(repo.getByRef).toHaveBeenCalledWith('ai-provider:anthropic');
      expect(result).toBe(sampleCredential);
    });
  });

  describe('create', () => {
    it('forwards the payload to repository.create and returns the credential verbatim', async () => {
      const repo = buildRepoMock();
      repo.create.mockResolvedValue(sampleCredential);
      const service = new CredentialsService(repo);

      const payload = {
        ref: 'ai-provider:anthropic',
        platformType: 'anthropic',
        credentialsJson: { apiKey: 'plain' },
      };
      const result = await service.create(payload);

      expect(repo.create).toHaveBeenCalledWith(payload);
      expect(result).toBe(sampleCredential);
    });
  });

  describe('update', () => {
    it('forwards (ref, patch) to repository.update and returns the credential verbatim', async () => {
      const repo = buildRepoMock();
      repo.update.mockResolvedValue(sampleCredential);
      const service = new CredentialsService(repo);

      const patch = { credentialsJson: { apiKey: 'rotated' } };
      const result = await service.update('ai-provider:anthropic', patch);

      expect(repo.update).toHaveBeenCalledWith('ai-provider:anthropic', patch);
      expect(result).toBe(sampleCredential);
    });
  });

  describe('delete', () => {
    it('forwards ref to repository.delete and returns the boolean verbatim', async () => {
      const repo = buildRepoMock();
      repo.delete.mockResolvedValue(true);
      const service = new CredentialsService(repo);

      const result = await service.delete('ai-provider:anthropic');

      expect(repo.delete).toHaveBeenCalledWith('ai-provider:anthropic');
      expect(result).toBe(true);
    });
  });

  describe('exception propagation', () => {
    // Pins the seam's failure contract: domain exceptions raised by the
    // repository surface unchanged to callers, so consumers like
    // `AiProviderKeyService.setKey` can keep their existing
    // `catch (error instanceof CredentialNotFoundException)` branches.
    it('propagates CredentialNotFoundException from the repository unchanged', async () => {
      const repo = buildRepoMock();
      repo.getByRef.mockRejectedValue(new CredentialNotFoundException('ai-provider:anthropic'));
      const service = new CredentialsService(repo);

      await expect(service.getByRef('ai-provider:anthropic')).rejects.toBeInstanceOf(
        CredentialNotFoundException
      );
    });
  });
});
