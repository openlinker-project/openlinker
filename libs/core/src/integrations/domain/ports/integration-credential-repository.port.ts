/**
 * Integration Credential Repository Port
 *
 * Defines the contract for IntegrationCredential persistence operations.
 * Implemented by IntegrationCredentialRepository to provide credential storage
 * capabilities for the credentials resolver service.
 *
 * @module libs/core/src/integrations/domain/ports
 * @see {@link IntegrationCredentialRepository} for the implementation
 */
import { IntegrationCredential } from '../entities/integration-credential.entity';

/**
 * Credential creation payload
 */
export interface CredentialCreate {
  ref: string;
  platformType: string;
  credentialsJson: Record<string, unknown>;
  encrypted?: boolean;
}

/**
 * Credential update payload
 */
export interface CredentialUpdate {
  credentialsJson?: Record<string, unknown>;
  encrypted?: boolean;
}

/**
 * Integration Credential Repository Port
 *
 * Interface for credential persistence operations.
 */
export interface IntegrationCredentialRepositoryPort {
  /**
   * Get credential by reference
   * @param ref - The credential reference (e.g., 'db:allegro_123')
   * @returns Credential entity or throws if not found
   */
  getByRef(ref: string): Promise<IntegrationCredential>;

  /**
   * Create a new credential
   * @param payload - Credential creation payload
   * @returns Created credential entity
   */
  create(payload: CredentialCreate): Promise<IntegrationCredential>;

  /**
   * Update an existing credential
   * @param ref - The credential reference
   * @param patch - Partial update payload
   * @returns Updated credential entity or throws if not found
   */
  update(ref: string, patch: CredentialUpdate): Promise<IntegrationCredential>;

  /**
   * Delete a credential by reference
   * @param ref - The credential reference
   * @returns True if deleted, false if not found
   */
  delete(ref: string): Promise<boolean>;
}



