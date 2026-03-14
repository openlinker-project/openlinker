/**
 * Integration Credential Domain Entity
 *
 * Represents stored credentials for an integration. Credentials are stored
 * separately from connections and referenced via credentialsRef. This allows
 * credentials to be managed independently and supports multiple credential
 * storage backends (database, vault, etc.).
 *
 * @module libs/core/src/integrations/domain/entities
 */
export class IntegrationCredential {
  constructor(
    public readonly id: string,
    public readonly ref: string,
    public readonly platformType: string,
    public readonly credentialsJson: Record<string, unknown>,
    public readonly encrypted: boolean,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}


