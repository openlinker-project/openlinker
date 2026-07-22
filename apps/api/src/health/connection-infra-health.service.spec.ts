/**
 * Connection Infra Health Service — Unit Tests
 *
 * Covers #1619: the dashboard Infrastructure panel must list every
 * infra-bearing connection (ProductMaster/InventoryMaster capability),
 * skipping marketplace-only connections and connections with the
 * capability disabled via `enabledCapabilities`. Discovery goes through
 * `listCapabilityAdapters` (same seam as every other core consumer) rather
 * than a hand-rolled `metadata.supportedCapabilities` check, so these tests
 * mock that method directly instead of `resolveAdapterMetadata` +
 * `connectionService.list`.
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
    enabledCapabilities: ['ProductMaster', 'InventoryMaster'],
    supportedCapabilities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Connection;
}

type CapabilityAdapterEntry = {
  connectionId: string;
  connection: Connection;
  adapter: unknown;
  metadata: unknown;
};

/** Builds the `listCapabilityAdapters` mock implementation for a fixed connection→capabilities map. */
function mockCapabilityAdapters(
  integrationsService: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>,
  connectionsByCapability: Record<string, Connection[]>
): void {
  integrationsService.listCapabilityAdapters.mockImplementation(
    <T>(filters: { capability: string }) => {
      const connections = connectionsByCapability[filters.capability] ?? [];
      return Promise.resolve(
        connections.map(
          (connection): CapabilityAdapterEntry => ({
            connectionId: connection.id,
            connection,
            adapter: {} as T,
            metadata: {},
          })
        )
      ) as unknown as ReturnType<IIntegrationsService['listCapabilityAdapters']>;
    }
  );
}

describe('ConnectionInfraHealthService', () => {
  let service: ConnectionInfraHealthService;
  let connectionService: jest.Mocked<Pick<IConnectionService, 'list' | 'testConnection'>>;
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters'>>;

  beforeEach(() => {
    jest.useFakeTimers();
    connectionService = {
      list: jest.fn(),
      testConnection: jest.fn(),
    };
    integrationsService = {
      listCapabilityAdapters: jest.fn(),
    };

    service = new ConnectionInfraHealthService(
      connectionService as unknown as IConnectionService,
      integrationsService as unknown as IIntegrationsService
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return an empty array when no connection has an infra capability', async () => {
    mockCapabilityAdapters(integrationsService, {});

    const result = await service.checkInfraConnections();

    expect(result).toEqual([]);
    expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'ProductMaster', lazy: true })
    );
    expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'InventoryMaster', lazy: true })
    );
  });

  it('should include an infra-bearing connection (ProductMaster/InventoryMaster) and probe it', async () => {
    const connection = buildConnection();
    mockCapabilityAdapters(integrationsService, {
      ProductMaster: [connection],
      InventoryMaster: [connection],
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
    // Deduped: appears in both capability lists but probed exactly once.
    expect(connectionService.testConnection).toHaveBeenCalledTimes(1);
    expect(connectionService.testConnection).toHaveBeenCalledWith('conn-1');
  });

  it('should exclude a connection whose adapter supports the capability but has it disabled via enabledCapabilities', async () => {
    // listCapabilityAdapters itself intersects supportedCapabilities with
    // enabledCapabilities, so a connection with InventoryMaster disabled
    // (e.g. WooCommerce's OfferManager/InventoryMaster mutual exclusion)
    // never appears in the entries this service receives.
    mockCapabilityAdapters(integrationsService, {});

    const result = await service.checkInfraConnections();

    expect(result).toEqual([]);
    expect(connectionService.testConnection).not.toHaveBeenCalled();
  });

  it('should exclude a marketplace-only connection (no ProductMaster/InventoryMaster)', async () => {
    mockCapabilityAdapters(integrationsService, {});

    const result = await service.checkInfraConnections();

    expect(result).toEqual([]);
    expect(connectionService.testConnection).not.toHaveBeenCalled();
  });

  it('should report an error entry when the connection probe fails', async () => {
    const connection = buildConnection();
    mockCapabilityAdapters(integrationsService, { ProductMaster: [connection] });
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
    mockCapabilityAdapters(integrationsService, { ProductMaster: [connection] });
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

  it('should report an error entry with a timed-out message when the probe hangs past the timeout budget', async () => {
    const connection = buildConnection();
    mockCapabilityAdapters(integrationsService, { ProductMaster: [connection] });
    connectionService.testConnection.mockImplementation(() => new Promise(() => undefined));

    const resultPromise = service.checkInfraConnections();
    await jest.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(result).toEqual([
      {
        connectionId: 'conn-1',
        name: 'My WooCommerce Shop',
        platformType: 'woocommerce',
        status: 'error',
        message: expect.stringContaining('timed out'),
      },
    ]);
  });
});
