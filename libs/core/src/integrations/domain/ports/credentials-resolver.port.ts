/**
 * Credentials Resolver Port
 *
 * Defines the contract for resolving credentials from credentials references.
 * Credentials are never stored directly in the database; only a reference
 * (credentialsRef) is stored. This port provides a secure way to resolve
 * credentials at runtime.
 *
 * Implementations can support various backends:
 * - Environment variables (MVP/dev)
 * - Encrypted local files
 * - Vault, AWS Secrets Manager, GCP Secret Manager (production)
 *
 * @module libs/core/src/integrations/domain/ports
 */
export interface CredentialsResolverPort {
  /**
   * Get credentials by reference
   *
   * Resolves credentials from a credentials reference. The reference format
   * is implementation-specific (e.g., 'env:PRESTASHOP_API_KEY' for env vars,
   * 'vault:secret/prestashop' for Vault, etc.).
   *
   * @param credentialsRef - Credentials reference (from Connection.credentialsRef)
   * @returns Credentials object (type depends on platform)
   * @throws Error if credentials cannot be resolved
   */
  get<T = unknown>(credentialsRef: string): Promise<T>;
}




