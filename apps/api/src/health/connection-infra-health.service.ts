/**
 * Connection Infra Health Service
 *
 * Rolls up the health of infrastructure-bearing connections (connections
 * that back a real shop/warehouse system, e.g. WooCommerce) into the
 * dashboard's Infrastructure panel (#1619). "Infrastructure-bearing" is
 * defined by capability, not by platform name — any adapter advertising
 * `ProductMaster` and/or `InventoryMaster` qualifies, so a future adapter
 * with the same capability shape is picked up automatically. Marketplace
 * adapters (Allegro, Erli, …) never qualify and are left to the existing
 * "Connection health" panel.
 *
 * @module apps/api/src/health
 * @implements {IConnectionInfraHealthService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IConnectionService } from '../integrations/application/interfaces/connection.service.interface';
import { CONNECTION_SERVICE_TOKEN } from '../integrations/application/interfaces/connection.service.interface';
import type { IConnectionInfraHealthService } from './connection-infra-health.service.interface';
import type { ConnectionHealthEntry, ServiceStatus } from './dev-stack-health.types';

const INFRA_CAPABILITIES = ['ProductMaster', 'InventoryMaster'];

@Injectable()
export class ConnectionInfraHealthService implements IConnectionInfraHealthService {
  private readonly logger = new Logger(ConnectionInfraHealthService.name);

  constructor(
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connectionService: IConnectionService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async checkInfraConnections(): Promise<ConnectionHealthEntry[]> {
    const connections = await this.connectionService.list({ status: 'active' });
    if (connections.length === 0) {
      return [];
    }

    const infraConnections = await this.filterInfraBearing(connections);
    return Promise.all(infraConnections.map((connection) => this.checkConnection(connection)));
  }

  private async filterInfraBearing(connections: Connection[]): Promise<Connection[]> {
    const flags = await Promise.all(
      connections.map(async (connection) => {
        try {
          const metadata = await this.integrationsService.resolveAdapterMetadata({
            platformType: connection.platformType,
            adapterKey: connection.adapterKey,
          });
          return metadata.supportedCapabilities.some((capability) =>
            INFRA_CAPABILITIES.includes(capability)
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `Could not resolve adapter metadata for connection ${connection.id}: ${errorMessage}`
          );
          return false;
        }
      })
    );
    return connections.filter((_, index) => flags[index]);
  }

  private async checkConnection(connection: Connection): Promise<ConnectionHealthEntry> {
    try {
      const result = await this.connectionService.testConnection(connection.id);
      const status: ServiceStatus = result.success ? 'ok' : 'error';
      return {
        connectionId: connection.id,
        name: connection.name,
        platformType: connection.platformType,
        status,
        message: result.success ? undefined : result.message,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Infra connection health check failed for ${connection.id}: ${errorMessage}`
      );
      return {
        connectionId: connection.id,
        name: connection.name,
        platformType: connection.platformType,
        status: 'warning',
        message: errorMessage,
      };
    }
  }
}
