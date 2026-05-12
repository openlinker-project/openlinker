/**
 * dispatchCapability — unit tests (#573)
 *
 * @module libs/plugin-sdk/src
 */
import { dispatchCapability } from './dispatch-capability';

describe('dispatchCapability', () => {
  it('returns the factory return value for a known capability', () => {
    const offerManager = { kind: 'offer-manager' as const };
    const orderSource = { kind: 'order-source' as const };

    const result = dispatchCapability<{ kind: string }>(
      'OfferManager',
      {
        OfferManager: () => offerManager,
        OrderSource: () => orderSource,
      },
      'Allegro',
    );

    expect(result).toBe(offerManager);
  });

  it('invokes only the matching factory (lazy dispatch)', () => {
    const offerFactory = jest.fn(() => 'offer');
    const orderFactory = jest.fn(() => 'order');

    dispatchCapability<string>(
      'OfferManager',
      {
        OfferManager: offerFactory,
        OrderSource: orderFactory,
      },
      'Allegro',
    );

    expect(offerFactory).toHaveBeenCalledTimes(1);
    expect(orderFactory).not.toHaveBeenCalled();
  });

  it('throws when the capability is not in the dispatch table, including the plugin name and supported set in the message', () => {
    expect(() =>
      dispatchCapability<unknown>(
        'PricingAuthority',
        {
          OfferManager: () => ({}),
          OrderSource: () => ({}),
        },
        'Allegro',
      ),
    ).toThrow(
      'Allegro adapter does not support capability: PricingAuthority. ' +
        'Supported capabilities: OfferManager, OrderSource',
    );
  });

  it('treats an empty dispatch table as "no supported capabilities" rather than crashing', () => {
    expect(() => dispatchCapability<unknown>('OfferManager', {}, 'Empty')).toThrow(
      'Empty adapter does not support capability: OfferManager. ' +
        'Supported capabilities: ',
    );
  });

  it('preserves the factory return value even for falsy / undefined results', () => {
    // Defensive: if a plugin author returns `undefined` from a factory (perhaps
    // because the adapter is conditionally wired), the helper should pass that
    // through faithfully rather than swallowing it. Catching "factory returned
    // undefined" is the plugin's responsibility, not the dispatcher's.
    const result = dispatchCapability<undefined>(
      'OrderProcessorManager',
      {
        OrderProcessorManager: () => undefined,
      },
      'PrestaShop',
    );

    expect(result).toBeUndefined();
  });
});
