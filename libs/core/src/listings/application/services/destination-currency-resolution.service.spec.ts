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

describe('DestinationCurrencyResolutionService', () => {
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let service: DestinationCurrencyResolutionService;

  beforeEach(() => {
    integrationsService = { getCapabilityAdapter: jest.fn() };
    service = new DestinationCurrencyResolutionService(
      integrationsService as unknown as IIntegrationsService,
    );
  });

  function resolveOnly(capability: string, adapter: unknown): void {
    integrationsService.getCapabilityAdapter.mockImplementation((_id: string, cap: string) =>
      cap === capability
        ? Promise.resolve(adapter as never)
        : Promise.reject(new Error(`not supported: ${cap}`)),
    );
  }

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
      getDestinationCurrency: () => 'USD',
    });

    await expect(service.resolveForConnection('conn-2')).resolves.toBe('USD');
  });

  it('prefers the marketplace capability when a connection somehow resolves both', async () => {
    integrationsService.getCapabilityAdapter.mockImplementation((_id: string, cap: string) =>
      Promise.resolve(
        (cap === 'OfferManager'
          ? { updateOfferQuantity: jest.fn(), getDestinationCurrency: () => 'PLN' }
          : { publishProduct: jest.fn(), getDestinationCurrency: () => 'USD' }) as never,
      ),
    );

    await expect(service.resolveForConnection('conn-3')).resolves.toBe('PLN');
  });

  it('falls through to the shop capability when the marketplace resolves but declares nothing', async () => {
    integrationsService.getCapabilityAdapter.mockImplementation((_id: string, cap: string) =>
      Promise.resolve(
        (cap === 'OfferManager'
          ? { updateOfferQuantity: jest.fn() }
          : { publishProduct: jest.fn(), getDestinationCurrency: () => 'USD' }) as never,
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

  it('never throws for an unknown connection', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValue(new Error('connection not found'));

    await expect(service.resolveForConnection('nope')).resolves.toBeNull();
  });
});
