/**
 * Credentials Service Interface
 *
 * Cross-context CRUD seam (#718) over `IntegrationCredentialRepositoryPort`.
 * Mirrors the repository surface one-for-one — sibling contexts that need to
 * read/write encrypted credentials (today: `ai`) consume this interface
 * instead of value-importing the repository port directly.
 *
 * Naming note: drops the "Integration" prefix used by the entity and
 * repository port, matching the `CredentialsResolverPort` precedent in this
 * context. "Credentials" is unambiguous within the integrations namespace,
 * and the shorter form reads better at call sites.
 *
 * @module libs/core/src/integrations/application/interfaces
 */
import type {
  CredentialCreate,
  CredentialUpdate,
} from '../../domain/ports/integration-credential-repository.port';
import type { IntegrationCredential } from '../../domain/entities/integration-credential.entity';

export interface ICredentialsService {
  /** Get credential by reference. Throws `CredentialNotFoundException` if absent. */
  getByRef(ref: string): Promise<IntegrationCredential>;

  /** Create a new credential. Plaintext at this layer; underlying repository encrypts. */
  create(payload: CredentialCreate): Promise<IntegrationCredential>;

  /** Update an existing credential. Throws `CredentialNotFoundException` if absent. */
  update(ref: string, patch: CredentialUpdate): Promise<IntegrationCredential>;

  /** Delete a credential by reference. Returns `true` if deleted, `false` if absent. */
  delete(ref: string): Promise<boolean>;
}
