/**
 * Destination Currency Resolution Service - unit tests (#3203)
 *
 * Mirrors `description-format-read.service.spec.ts` — the same "resolve
 * whichever capability answers" shape, applied to currency instead of
 * description grammar.
 *
 * @module libs/core/src/listings/application/services
 */
import { DestinationCurrencyResolutionService } from './destination-currency-resolution.service';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';

function buildConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'allegro',
    name: 'Test connection',
    status: 'active',
    config: {},
    credentialsRef: 'ref',
    adapterKey: undefined,
    enabledCapabilities: ['OfferManager', 'ProductPublisher'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Connection;
}

function buildMetadata(overrides: Partial<AdapterMetadata> = {}): AdapterMetadata {
  return {
    adapterKey: 'allegro.publicapi.v1',
    platformType: 'allegro',
    supportedCapabilities: ['OfferManager', 'ProductPublisher'],
    ...overrides,
  } as AdapterMetadata;
}

describe('DestinationCurrencyResolutionService', () => {
  let integrationsService: jest.Mocked<
    Pick<IIntegrationsService, 'getCapabilityAdapter' | 'resolveAdapterMetadata'>
  >;
  let connections: jest.Mocked<Pick<ConnectionPort, 'get'>>;
  let service: DestinationCurrencyResolutionService;

  beforeEach(() => {
    integrationsService = {
      getCapabilityAdapter: jest.fn(),
      resolveAdapterMetadata: jest.fn().mockResolvedValue(buildMetadata()),
    };
    connections = { get: jest.fn().mockResolvedValue(buildConnection()) };
    service = new DestinationCurrencyResolutionService(
      integrationsService as unknown as IIntegrationsService,
      connections as unknown as ConnectionPort,
    );
  });

  function resolveOnly(capability: string, adapter: unknown): void {
    integrationsService.getCapabilityAdapter.mockImplementation((_id: string, cap: string) =>
      cap === capability
        ? Promise.resolve(adapter as never)
        : Promise.reject(new Error(`not supported: ${cap}`)),
    );
  }

  it('returns null when the connection cannot be resolved', async () => {
    connections.get.mockRejectedValue(new Error('connection not found'));

    await expect(service.resolveForConnection('nope')).resolves.toBeNull();
    expect(integrationsService.resolveAdapterMetadata).not.toHaveBeenCalled();
  });

  it('returns null when the manifest does not support either capability, without constructing an adapter (#3159 review, SUGGESTION)', async () => {
    integrationsService.resolveAdapterMetadata.mockResolvedValue(
      buildMetadata({ supportedCapabilities: [] }),
    );

    await expect(service.resolveForConnection('conn-1')).resolves.toBeNull();
    expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('returns null when the capability is supported but not enabled on this connection, without constructing an adapter', async () => {
    connections.get.mockResolvedValue(buildConnection({ enabledCapabilities: [] }));

    await expect(service.resolveForConnection('conn-1')).resolves.toBeNull();
    expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('returns the marketplace-declared currency', async () => {
    resolveOnly('OfferManager', {
      updateOfferQuantity: jest.fn(),
      getDestinationCurrency: () => 'PLN',
    });

    await expect(service.resolveForConnection('conn-1')).resolves.toBe('PLN');
  });

  it('falls through to the shop capability when the connection is not a marketplace', async () => {
    resolveOnly('ProductPublisher', {
      publishProduct: jest.fn(),
      getDestinationCurrency: () => Promise.resolve('USD'),
    });

    await expect(service.resolveForConnection('conn-2')).resolves.toBe('USD');
  });

  it('prefers the marketplace capability when a connection somehow resolves both', async () => {
    integrationsService.getCapabilityAdapter.mockImplementation((_id: string, cap: string) =>
      Promise.resolve(
        (cap === 'OfferManager'
          ? { updateOfferQuantity: jest.fn(), getDestinationCurrency: () => 'PLN' }
          : { publishProduct: jest.fn(), getDestinationCurrency: () => Promise.resolve('USD') }) as never,
      ),
    );

    await expect(service.resolveForConnection('conn-3')).resolves.toBe('PLN');
  });

  it('falls through to the shop capability when the marketplace resolves but declares nothing', async () => {
    integrationsService.getCapabilityAdapter.mockImplementation((_id: string, cap: string) =>
      Promise.resolve(
        (cap === 'OfferManager'
          ? { updateOfferQuantity: jest.fn() }
          : { publishProduct: jest.fn(), getDestinationCurrency: () => Promise.resolve('USD') }) as never,
      ),
    );

    await expect(service.resolveForConnection('conn-4')).resolves.toBe('USD');
  });

  it('returns null when no capability resolves at all', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValue(new Error('adapter unresolved'));

    await expect(service.resolveForConnection('conn-5')).resolves.toBeNull();
  });

  it('returns null when every resolved adapter declares nothing', async () => {
    integrationsService.getCapabilityAdapter.mockImplementation((_id: string, cap: string) =>
      Promise.resolve(
        (cap === 'OfferManager'
          ? { updateOfferQuantity: jest.fn() }
          : { publishProduct: jest.fn() }) as never,
      ),
    );

    await expect(service.resolveForConnection('conn-6')).resolves.toBeNull();
  });

  it('returns null when resolveAdapterMetadata itself fails', async () => {
    integrationsService.resolveAdapterMetadata.mockRejectedValue(new Error('registry unavailable'));

    await expect(service.resolveForConnection('conn-7')).resolves.toBeNull();
  });
});
