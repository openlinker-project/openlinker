/**
 * Operator payment-method map (#3774)
 *
 * The map only FILLS an `unknown` the platform left, never overrides a platform
 * answer, and its keys and the looked-up identifier are normalised by ONE
 * function so `PayU` reported verbatim still hits a `payu` entry.
 *
 * @module libs/core/src/orders/domain/types
 */
import {
  PAYMENT_METHOD_MAP_CONFIG_KEY,
  findPaymentMethodMapKeyCollisions,
  normalizeSourcePaymentMethodKey,
  readPaymentMethodMap,
  resolveSourcePaymentMethod,
} from './payment-method-map.types';

describe('normalizeSourcePaymentMethodKey', () => {
  it.each([
    ['PayU', 'payu'],
    ['  przelewy24  ', 'przelewy24'],
    ['PS_CashOnDelivery', 'ps_cashondelivery'],
    ['   ', ''],
    ['', ''],
  ])('should normalise %j to %j', (raw, expected) => {
    expect(normalizeSourcePaymentMethodKey(raw)).toBe(expected);
  });
});

describe('readPaymentMethodMap', () => {
  const config = (value: unknown): Record<string, unknown> => ({
    [PAYMENT_METHOD_MAP_CONFIG_KEY]: value,
  });

  it('should normalise keys and keep valid methods', () => {
    const map = readPaymentMethodMap(
      config({ PayU: 'online', ' Przelewy24 ': 'online', Cheque: 'bank_transfer' })
    );

    expect(map.get('payu')).toBe('online');
    expect(map.get('przelewy24')).toBe('online');
    expect(map.get('cheque')).toBe('bank_transfer');
    expect(map.size).toBe(3);
  });

  it.each([
    ['absent config', undefined],
    ['null config', null],
    ['empty config', {}],
    ['null map', config(null)],
    ['string map', config('payu')],
    ['array map', config(['payu'])],
    ['number map', config(5)],
  ])('should read %s as an empty map', (_label, value) => {
    expect(readPaymentMethodMap(value as never).size).toBe(0);
  });

  it('should drop blank keys, unknown values, non-string values and non-members', () => {
    const map = readPaymentMethodMap(
      config({
        '': 'online',
        '   ': 'online',
        payu: 'unknown',
        p24: 'card',
        stripe: 7,
        paypal: null,
        good: 'cash_on_delivery',
      })
    );

    expect([...map.entries()]).toEqual([['good', 'cash_on_delivery']]);
  });
});

describe('findPaymentMethodMapKeyCollisions', () => {
  it('should report keys that collide after normalisation, whatever their values', () => {
    expect(
      findPaymentMethodMapKeyCollisions({
        PayU: 'online',
        payu: 'bank_transfer',
        ' PAYU ': 'online',
        other: 'online',
      })
    ).toEqual([['PayU', 'payu', ' PAYU ']]);
  });

  it('should report nothing for a map without collisions', () => {
    expect(findPaymentMethodMapKeyCollisions({ payu: 'online', p24: 'online' })).toEqual([]);
  });

  it('should not treat blank keys as a collision', () => {
    expect(findPaymentMethodMapKeyCollisions({ '': 'online', '  ': 'online' })).toEqual([]);
  });
});

describe('resolveSourcePaymentMethod', () => {
  const map = new Map<string, 'online' | 'bank_transfer' | 'cash_on_delivery'>([
    ['payu', 'online'],
    ['ps_cashondelivery', 'online'],
    ['pobranie_plus', 'cash_on_delivery'],
  ]);

  it('should fill an unknown platform answer from the operator map', () => {
    expect(
      resolveSourcePaymentMethod({
        platformMethod: 'unknown',
        sourcePaymentMethod: 'payu',
        map,
      })
    ).toEqual({ method: 'online', resolvedBy: 'operator' });
  });

  it('should look up a mixed-case, padded identifier against a lowercase key', () => {
    expect(
      resolveSourcePaymentMethod({
        platformMethod: 'unknown',
        sourcePaymentMethod: '  PayU ',
        map,
      })
    ).toEqual({ method: 'online', resolvedBy: 'operator' });
  });

  it('should never override a platform-defined answer', () => {
    expect(
      resolveSourcePaymentMethod({
        platformMethod: 'cash_on_delivery',
        sourcePaymentMethod: 'ps_cashondelivery',
        map,
      })
    ).toEqual({ method: 'cash_on_delivery', resolvedBy: 'platform' });
  });

  it('should answer unknown when the map has no entry', () => {
    expect(
      resolveSourcePaymentMethod({
        platformMethod: 'unknown',
        sourcePaymentMethod: 'stripe',
        map,
      })
    ).toEqual({ method: 'unknown', resolvedBy: 'none' });
  });

  it.each([[undefined], [''], ['   ']])(
    'should never hit the map for the identifier %j',
    (identifier) => {
      const withBlank = new Map(map).set('', 'online');

      expect(
        resolveSourcePaymentMethod({
          platformMethod: 'unknown',
          sourcePaymentMethod: identifier,
          map: withBlank,
        })
      ).toEqual({ method: 'unknown', resolvedBy: 'none' });
    }
  );
});
