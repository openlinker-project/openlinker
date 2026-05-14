/**
 * Integration Credential Repository Port
 *
 * Defines the contract for IntegrationCredential persistence operations.
 * Implemented by IntegrationCredentialRepository to provide credential
 * storage capabilities for the credentials resolver service.
 *
 * The `encrypted` field that previously parameterized create/update was
 * removed in #709 — credentials are now ALWAYS encrypted at rest. Callers
 * pass plaintext `credentialsJson` and the repository handles encryption
 * internally via `CryptoService`.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link IntegrationCredentialRepository} for the implementation
 */
import type { IntegrationCredential } from '../entities/integration-credential.entity';

/**
 * Credential creation payload. `credentialsJson` is plaintext at this layer —
 * the repository encrypts it before persistence.
 */
export interface CredentialCreate {
  ref: string;
  platformType: string;
  credentialsJson: Record<string, unknown>;
}

/**
 * Credential update payload. Same plaintext-at-this-layer rule as
 * `CredentialCreate`.
 */
export interface CredentialUpdate {
  credentialsJson?: Record<string, unknown>;
}

/**
 * Integration Credential Repository Port
 *
 * Interface for credential persistence operations.
 */
export interface IntegrationCredentialRepositoryPort {
  /**
   * Get credential by reference.
   * @param ref - The credential reference (e.g., 'webhook-secret:123')
   * @returns Decrypted credential entity, or throws if not found.
   */
  getByRef(ref: string): Promise<IntegrationCredential>;

  /**
   * Create a new credential. `payload.credentialsJson` is plaintext at this
   * layer; the implementation encrypts it before persistence.
   */
  create(payload: CredentialCreate): Promise<IntegrationCredential>;

  /**
   * Update an existing credential. Returns the decrypted post-update entity
   * or throws if the ref is unknown.
   */
  update(ref: string, patch: CredentialUpdate): Promise<IntegrationCredential>;

  /**
   * Delete a credential by reference.
   * @returns True if deleted, false if not found.
   */
  delete(ref: string): Promise<boolean>;
}
