/**
 * Credentials Service
 *
 * Thin pass-through over `IntegrationCredentialRepositoryPort` — the
 * cross-context read/write seam for sibling contexts that need encrypted
 * credential storage. Created in #718 (slice 4) to remove direct
 * cross-context value-imports of the repository port from the `ai` context.
 *
 * No business logic lives here. Upsert / cache-invalidation / per-provider
 * branching all stay in callers (e.g. `AiProviderKeyService`) where the
 * application-level intent is expressed. Centralising those concerns here
 * would change semantics and obscure the caller's intent.
 *
 * @module libs/core/src/integrations/application/services
 * @implements {ICredentialsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationCredential } from '../../domain/entities/integration-credential.entity';
import {
  IntegrationCredentialRepositoryPort} from '../../domain/ports/integration-credential-repository.port';
import type {
  CredentialCreate,
  CredentialUpdate
} from '../../domain/ports/integration-credential-repository.port';
import { INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN } from '../../integrations.tokens';
import type { ICredentialsService } from '../interfaces/credentials.service.interface';

@Injectable()
export class CredentialsService implements ICredentialsService {
  constructor(
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    private readonly repository: IntegrationCredentialRepositoryPort
  ) {}

  getByRef(ref: string): Promise<IntegrationCredential> {
    return this.repository.getByRef(ref);
  }

  create(payload: CredentialCreate): Promise<IntegrationCredential> {
    return this.repository.create(payload);
  }

  update(ref: string, patch: CredentialUpdate): Promise<IntegrationCredential> {
    return this.repository.update(ref, patch);
  }

  delete(ref: string): Promise<boolean> {
    return this.repository.delete(ref);
  }
}
