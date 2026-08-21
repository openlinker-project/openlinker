/**
 * Description Format Read Service - unit tests
 *
 * The interesting behaviour is the probe order and the `declared` flag: a UI
 * that cannot tell a real declaration from the fallback would present the
 * conservative subset as authoritative, which is the failure ADR-046's
 * subordinate decision 1 exists to prevent.
 *
 * @module libs/core/src/listings/application/services
 */
import { DescriptionFormatReadService } from './description-format-read.service';
import {
  CONSERVATIVE_DESCRIPTION_FORMAT,
  type DescriptionFormat,
} from '../../domain/types/description-format.types';
import type { IIntegrationsService } from '@openlinker/core/integrations';

const MARKETPLACE_FORMAT: DescriptionFormat = {
  shape: 'html',
  allowedTags: ['p', 'b'],
  allowedAttributes: {},
  contentModel: null,
  rewrites: [],
  requiresBlockOpener: true,
  maxBytes: 40000,
};

const SHOP_FORMAT: DescriptionFormat = {
  shape: 'html',
  allowedTags: ['p', 'b', 'a', 'table'],
  allowedAttributes: { a: ['href'] },
  contentModel: null,
  rewrites: [],
  maxBytes: 65536,
};

describe('DescriptionFormatReadService', () => {
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let service: DescriptionFormatReadService;

  beforeEach(() => {
    integrationsService = { getCapabilityAdapter: jest.fn() };
    service = new DescriptionFormatReadService(
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

  it('should return a marketplace declaration and report it as declared', async () => {
    resolveOnly('OfferManager', {
      updateOfferQuantity: jest.fn(),
      getDescriptionFormat: () => MARKETPLACE_FORMAT,
    });

    await expect(service.getForConnection('conn-1')).resolves.toEqual({
      format: MARKETPLACE_FORMAT,
      declared: true,
      resolvedVia: 'OfferManager',
    });
  });

  it('should fall through to the shop capability when the connection is not a marketplace', async () => {
    resolveOnly('ProductPublisher', {
      publishProduct: jest.fn(),
      getDescriptionFormat: () => SHOP_FORMAT,
    });

    await expect(service.getForConnection('conn-2')).resolves.toEqual({
      format: SHOP_FORMAT,
      declared: true,
      resolvedVia: 'ProductPublisher',
    });
  });

  it('should prefer the marketplace capability when a connection somehow resolves both', async () => {
    integrationsService.getCapabilityAdapter.mockImplementation((_id: string, cap: string) =>
      Promise.resolve(
        (cap === 'OfferManager'
          ? { updateOfferQuantity: jest.fn(), getDescriptionFormat: () => MARKETPLACE_FORMAT }
          : { publishProduct: jest.fn(), getDescriptionFormat: () => SHOP_FORMAT }) as never,
      ),
    );

    const view = await service.getForConnection('conn-3');
    expect(view.resolvedVia).toBe('OfferManager');
    expect(view.format).toBe(MARKETPLACE_FORMAT);
  });

  it('should report declared: false when the adapter declares nothing', async () => {
    // The UI needs to distinguish "this is what the destination accepts" from
    // "nobody told us, here is a safe subset".
    resolveOnly('OfferManager', { updateOfferQuantity: jest.fn() });

    await expect(service.getForConnection('conn-4')).resolves.toEqual({
      format: CONSERVATIVE_DESCRIPTION_FORMAT,
      declared: false,
      resolvedVia: 'OfferManager',
    });
  });

  it('should still return a usable format when no capability resolves at all', async () => {
    // A disabled connection or a credential failure. The editor needs something
    // to author against, and an error here is not something an operator can act
    // on from a description field.
    integrationsService.getCapabilityAdapter.mockRejectedValue(new Error('adapter unresolved'));

    await expect(service.getForConnection('conn-5')).resolves.toEqual({
      format: CONSERVATIVE_DESCRIPTION_FORMAT,
      declared: false,
      resolvedVia: null,
    });
  });

  it('should never throw for an unknown connection', async () => {
    integrationsService.getCapabilityAdapter.mockRejectedValue(new Error('connection not found'));
    await expect(service.getForConnection('nope')).resolves.toBeDefined();
  });

  it('should prefer a declared shop format over an OfferManager that declares nothing', async () => {
    // A WooCommerce connection with #1498 stock write-back enabled resolves BOTH
    // capabilities: `OfferManager` to a base-port-only adapter that declares
    // nothing, and `ProductPublisher` to the one that does. Accepting the first
    // answer handed the editor the conservative subset and told the operator
    // their shop had declared no format.
    const shopFormat: DescriptionFormat = {
      ...CONSERVATIVE_DESCRIPTION_FORMAT,
      allowedTags: ['p', 'a', 'table', 'h3'],
      contentModel: null,
      maxBytes: null,
    };
    integrationsService.getCapabilityAdapter.mockImplementation((_id: string, capability: string) =>
      capability === 'OfferManager'
        ? Promise.resolve({ updateOfferQuantity: jest.fn() } as never)
        : Promise.resolve({
            getDescriptionFormat: () => shopFormat,
            publishProduct: jest.fn(),
          } as never),
    );

    const view = await service.getForConnection('conn-1');

    expect(view.resolvedVia).toBe('ProductPublisher');
    expect(view.declared).toBe(true);
    expect(view.format.allowedTags).toContain('table');
  });

  it('should report an unresolvable connection as unresolved rather than undeclared', async () => {
    // A disabled connection and an adapter that declares nothing are different
    // facts; collapsing them makes the UI state a falsehood about the operator's
    // own configuration.
    integrationsService.getCapabilityAdapter.mockRejectedValue(new Error('connection disabled'));

    const view = await service.getForConnection('conn-1');

    expect(view.resolvedVia).toBeNull();
    expect(view.declared).toBe(false);
    expect(view.format).toBe(CONSERVATIVE_DESCRIPTION_FORMAT);
  });
});
