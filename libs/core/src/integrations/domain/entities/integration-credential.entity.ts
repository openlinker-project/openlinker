/**
 * Integration Credential Domain Entity
 *
 * Represents stored credentials for an integration. Credentials are stored
 * separately from connections and referenced via `credentialsRef`. The
 * `credentialsJson` field on this domain entity is **always plaintext** —
 * the encryption-at-rest envelope (#709) is repository-internal and the
 * domain entity is only constructed after decryption.
 *
 * @module libs/core/src/integrations/domain/entities
 */
export class IntegrationCredential {
  constructor(
    public readonly id: string,
    public readonly ref: string,
    public readonly platformType: string,
    public readonly credentialsJson: Record<string, unknown>,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
