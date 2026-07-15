/**
 * Connection Infra Health Service — Unit Tests
 *
 * Covers #1619: the dashboard Infrastructure panel must list every
 * infra-bearing connection (ProductMaster/InventoryMaster capability),
 * skipping marketplace-only connections and connections with no registered
 * tester.
 *
 * @module apps/api/src/health
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { ConnectionInfraHealthService } from './connection-infra-health.service';
import type { IConnectionService } from '../integrations/application/interfaces/connection.service.interface';

function buildConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    name: 'My WooCommerce Shop',
    platformType: 'woocommerce',
    status: 'active',
    config: {},
    credentialsBacked: true,
    adapterKey: 'woocommerce.restapi.v3',
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Connection;
}

describe('ConnectionInfraHealthService', () => {
  let service: ConnectionInfraHealthService;
  let connectionService: jest.Mocked<Pick<IConnectionService, 'list' | 'testConnection'>>;
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'resolveAdapterMetadata'>>;

  beforeEach(() => {
    connectionService = {
      list: jest.fn(),
      testConnection: jest.fn(),
    };
    integrationsService = {
      resolveAdapterMetadata: jest.fn(),
    };

    service = new ConnectionInfraHealthService(
      connectionService as unknown as IConnectionService,
      integrationsService as unknown as IIntegrationsService
    );
  });

  it('should return an empty array when there are no active connections', async () => {
    connectionService.list.mockResolvedValue([]);

    const result = await service.checkInfraConnections();

    expect(result).toEqual([]);
    expect(integrationsService.resolveAdapterMetadata).not.toHaveBeenCalled();
  });

  it('should include an infra-bearing connection (ProductMaster/InventoryMaster) and probe it', async () => {
    const connection = buildConnection();
    connectionService.list.mockResolvedValue([connection]);
    integrationsService.resolveAdapterMetadata.mockResolvedValue({
      adapterKey: 'woocommerce.restapi.v3',
      platformType: 'woocommerce',
      supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager'],
      displayName: 'WooCommerce REST API v3',
      version: '1.0.0',
    });
    connectionService.testConnection.mockResolvedValue({
      success: true,
      latencyMs: 42,
      message: 'OK',
    });

    const result = await service.checkInfraConnections();

    expect(result).toEqual([
      {
        connectionId: 'conn-1',
        name: 'My WooCommerce Shop',
        platformType: 'woocommerce',
        status: 'ok',
        message: undefined,
      },
    ]);
    expect(connectionService.testConnection).toHaveBeenCalledWith('conn-1');
  });

  it('should exclude a marketplace-only connection (no ProductMaster/InventoryMaster)', async () => {
    const connection = buildConnection({ id: 'conn-2', platformType: 'allegro' });
    connectionService.list.mockResolvedValue([connection]);
    integrationsService.resolveAdapterMetadata.mockResolvedValue({
      adapterKey: 'allegro.publicapi.v1',
      platformType: 'allegro',
      supportedCapabilities: ['OrderSource', 'OfferManager'],
      displayName: 'Allegro Public API v1',
      version: '1.0.0',
    });

    const result = await service.checkInfraConnections();

    expect(result).toEqual([]);
    expect(connectionService.testConnection).not.toHaveBeenCalled();
  });

  it('should report an error entry when the connection probe fails', async () => {
    const connection = buildConnection();
    connectionService.list.mockResolvedValue([connection]);
    integrationsService.resolveAdapterMetadata.mockResolvedValue({
      adapterKey: 'woocommerce.restapi.v3',
      platformType: 'woocommerce',
      supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
      displayName: 'WooCommerce REST API v3',
      version: '1.0.0',
    });
    connectionService.testConnection.mockResolvedValue({
      success: false,
      latencyMs: 12,
      message: 'Unauthorized (401)',
    });

    const result = await service.checkInfraConnections();

    expect(result).toEqual([
      {
        connectionId: 'conn-1',
        name: 'My WooCommerce Shop',
        platformType: 'woocommerce',
        status: 'error',
        message: 'Unauthorized (401)',
      },
    ]);
  });

  it('should report a warning entry when the probe itself throws (e.g. unsupported adapter)', async () => {
    const connection = buildConnection();
    connectionService.list.mockResolvedValue([connection]);
    integrationsService.resolveAdapterMetadata.mockResolvedValue({
      adapterKey: 'woocommerce.restapi.v3',
      platformType: 'woocommerce',
      supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
      displayName: 'WooCommerce REST API v3',
      version: '1.0.0',
    });
    connectionService.testConnection.mockRejectedValue(
      new Error('Connection testing is not supported for adapter woocommerce.restapi.v3')
    );

    const result = await service.checkInfraConnections();

    expect(result).toEqual([
      {
        connectionId: 'conn-1',
        name: 'My WooCommerce Shop',
        platformType: 'woocommerce',
        status: 'warning',
        message: 'Connection testing is not supported for adapter woocommerce.restapi.v3',
      },
    ]);
  });

  it('should skip a connection whose adapter metadata cannot be resolved', async () => {
    const connection = buildConnection();
    connectionService.list.mockResolvedValue([connection]);
    integrationsService.resolveAdapterMetadata.mockRejectedValue(new Error('adapter not found'));

    const result = await service.checkInfraConnections();

    expect(result).toEqual([]);
    expect(connectionService.testConnection).not.toHaveBeenCalled();
  });
});
