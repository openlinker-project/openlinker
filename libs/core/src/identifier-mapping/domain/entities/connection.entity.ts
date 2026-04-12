/**
 * Connection Domain Entity
 *
 * Represents a configured integration instance (e.g., a specific PrestaShop store,
 * a specific Allegro account). This entity encapsulates platform-specific
 * configuration, credentials reference, status, optional adapter key, and the
 * set of capabilities the operator has enabled for this connection. Used by the
 * identifier mapping service to resolve platform type from connection ID and by
 * the integrations service for adapter resolution.
 *
 * @module libs/core/src/identifier-mapping/domain/entities
 * @see {@link ConnectionPort} for the port interface
 */
import {
  PlatformType,
  ConnectionStatus,
  ConnectionConfig,
} from '../types/connection.types';
import type { Capability } from '@openlinker/core/integrations/domain/types/adapter.types';

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
    public readonly adapterKey: string | undefined,
    public readonly enabledCapabilities: Capability[],
  ) {}
}
