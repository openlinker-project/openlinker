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
 * Discovery goes through `IIntegrationsService.listCapabilityAdapters` (the
 * same seam `OrderSyncService` and every other core consumer uses) rather
 * than hand-rolling a `metadata.supportedCapabilities` check, so a
 * connection with the capability disabled via `enabledCapabilities` (e.g. a
 * WooCommerce connection with `InventoryMaster` turned off in favor of
 * `OfferManager` — see the mutual-exclusion note in
 * docs/architecture-overview.md) is correctly excluded here too.
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
import { HealthCheckTimeoutError, withTimeout } from './with-timeout.util';

const INFRA_CAPABILITIES = ['ProductMaster', 'InventoryMaster'];
const CHECK_TIMEOUT_MS = 5000;

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
    const infraConnections = await this.discoverInfraBearingConnections();
    if (infraConnections.length === 0) {
      return [];
    }

    return Promise.all(infraConnections.map((connection) => this.checkConnection(connection)));
  }

  /**
   * Discover active connections that both (a) have an adapter advertising an
   * infra-bearing capability and (b) have that capability enabled on the
   * connection itself. `listCapabilityAdapters` already intersects
   * `metadata.supportedCapabilities` with `connection.enabledCapabilities`
   * per capability (#1619 review) — called once per infra capability since
   * the port only takes a single capability, then deduped by connection id
   * (a connection may qualify via both `ProductMaster` and `InventoryMaster`).
   */
  private async discoverInfraBearingConnections(): Promise<Connection[]> {
    const byConnectionId = new Map<string, Connection>();

    for (const capability of INFRA_CAPABILITIES) {
      const entries = await this.integrationsService.listCapabilityAdapters<unknown>({
        capability,
        lazy: true,
      });
      for (const entry of entries) {
        byConnectionId.set(entry.connectionId, entry.connection);
      }
    }

    return Array.from(byConnectionId.values());
  }

  private async checkConnection(connection: Connection): Promise<ConnectionHealthEntry> {
    try {
      const result = await withTimeout(
        this.connectionService.testConnection(connection.id),
        `Infra connection health check timed out after ${CHECK_TIMEOUT_MS}ms`,
        CHECK_TIMEOUT_MS
      );
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
      if (error instanceof HealthCheckTimeoutError) {
        this.logger.warn(
          `Infra connection health check timed out for ${connection.id}: ${errorMessage}`
        );
        return {
          connectionId: connection.id,
          name: connection.name,
          platformType: connection.platformType,
          status: 'error',
          message: errorMessage,
        };
      }
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
