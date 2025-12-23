/**
 * Connection Domain Entity
 *
 * Represents a configured integration instance (e.g., a specific PrestaShop store,
 * a specific Allegro account). This entity encapsulates platform-specific
 * configuration, credentials reference, and status. Used by the identifier
 * mapping service to resolve platform type from connection ID.
 *
 * @module libs/core/src/identifier-mapping/domain/entities
 */
import {
  PlatformType,
  ConnectionStatus,
  ConnectionConfig,
} from '../types/connection.types';

export class Connection {
  constructor(
    public readonly id: string,
    public readonly platformType: PlatformType,
    public readonly name: string,
    public readonly status: ConnectionStatus,
    public readonly config: ConnectionConfig,
    public readonly credentialsRef: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}



