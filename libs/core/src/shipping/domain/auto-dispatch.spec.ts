import {
  resolveAutoDispatchDeliveryIntent,
  resolveAutoDispatchParcel,
  resolveAutoDispatchRecipient,
  type AutoDispatchWorkLine,
} from './auto-dispatch';
import type { Address, OrderPickupPoint, OrderShipping } from '@openlinker/core/orders';
import { REDACTED_PLACEHOLDER } from '@openlinker/core/orders';

function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    address1: 'ul. Testowa 1',
    city: 'Poznań',
    postalCode: '61-001',
    country: 'PL',
    phone: '+48123456789',
    firstName: 'Jan',
    lastName: 'Kowalski',
    ...overrides,
  };
}

describe('resolveAutoDispatchDeliveryIntent', () => {
  it('should resolve pickup_point when a pickup point is present, regardless of the method name', () => {
    const pickupPoint: OrderPickupPoint = { id: 'POZ08A' };
    const shipping: OrderShipping = { methodId: 'm1', methodName: 'DPD Courier' };

    expect(resolveAutoDispatchDeliveryIntent(shipping, pickupPoint)).toBe('pickup_point');
  });

  it('should resolve address when there is no shipping reference at all', () => {
    expect(resolveAutoDispatchDeliveryIntent(undefined, undefined)).toBe('address');
  });

  it('should resolve pickup_point from a locker-keyword method name', () => {
    const shipping: OrderShipping = { methodId: 'm1', methodName: 'Paczkomat 24/7' };
    expect(resolveAutoDispatchDeliveryIntent(shipping, undefined)).toBe('pickup_point');
  });

  it('should resolve pickup_point from a locker-keyword method id when no name is present', () => {
    const shipping: OrderShipping = { methodId: 'allegro-automat-24' };
    expect(resolveAutoDispatchDeliveryIntent(shipping, undefined)).toBe('pickup_point');
  });

  it('should resolve address for an ordinary courier method', () => {
    const shipping: OrderShipping = { methodId: 'm1', methodName: 'DPD Courier' };
    expect(resolveAutoDispatchDeliveryIntent(shipping, undefined)).toBe('address');
  });
});

describe('resolveAutoDispatchParcel', () => {
  const lines: AutoDispatchWorkLine[] = [
    { productVariantId: 'v1', totalQuantity: 2, cancelledQuantity: 0 },
    { productVariantId: 'v2', totalQuantity: 1, cancelledQuantity: 0 },
  ];

  it('should sum (totalQuantity - cancelledQuantity) * variant weight over every line', () => {
    const weights = new Map([
      ['v1', 200],
      ['v2', 500],
    ]);

    const parcel = resolveAutoDispatchParcel(lines, weights, {});

    expect(parcel).toEqual({ weightGrams: 900 });
  });

  it('should exclude a fully-cancelled line from the sum', () => {
    const partiallyCancelled: AutoDispatchWorkLine[] = [
      { productVariantId: 'v1', totalQuantity: 2, cancelledQuantity: 2 },
      { productVariantId: 'v2', totalQuantity: 1, cancelledQuantity: 0 },
    ];
    const weights = new Map([
      ['v1', 200],
      ['v2', 500],
    ]);

    const parcel = resolveAutoDispatchParcel(partiallyCancelled, weights, {});

    expect(parcel).toEqual({ weightGrams: 500 });
  });

  it('should fall back to defaultWeightGrams for a line whose variant carries no weight', () => {
    const weights = new Map<string, number | null | undefined>([
      ['v1', null],
      ['v2', 500],
    ]);

    const parcel = resolveAutoDispatchParcel(lines, weights, { defaultWeightGrams: 100 });

    // v1: 2 * 100 (fallback) + v2: 1 * 500 = 700
    expect(parcel).toEqual({ weightGrams: 700 });
  });

  it('should refuse (return null) when a line has no weight and no fallback', () => {
    const weights = new Map<string, number | null | undefined>([
      ['v1', undefined],
      ['v2', 500],
    ]);

    expect(resolveAutoDispatchParcel(lines, weights, {})).toBeNull();
  });

  it('should refuse when a variant is entirely absent from the weight map', () => {
    const weights = new Map([['v2', 500]]);

    expect(resolveAutoDispatchParcel(lines, weights, {})).toBeNull();
  });

  it('should refuse a non-positive or non-finite fallback', () => {
    const weights = new Map<string, number | null | undefined>([
      ['v1', undefined],
      ['v2', 500],
    ]);

    expect(resolveAutoDispatchParcel(lines, weights, { defaultWeightGrams: 0 })).toBeNull();
    expect(
      resolveAutoDispatchParcel(lines, weights, { defaultWeightGrams: Number.NaN }),
    ).toBeNull();
  });

  it('should refuse when every line is fully cancelled (nothing to weigh)', () => {
    const allCancelled: AutoDispatchWorkLine[] = [
      { productVariantId: 'v1', totalQuantity: 2, cancelledQuantity: 2 },
    ];
    const weights = new Map([['v1', 200]]);

    expect(resolveAutoDispatchParcel(allCancelled, weights, {})).toBeNull();
  });

  it('should refuse when there are no lines at all', () => {
    expect(resolveAutoDispatchParcel([], new Map(), {})).toBeNull();
  });

  it('should carry the operator-chosen parcelTemplate alongside the resolved weight, never summing dimensions', () => {
    const weights = new Map([
      ['v1', 200],
      ['v2', 500],
    ]);

    const parcel = resolveAutoDispatchParcel(lines, weights, { parcelTemplate: 'small' });

    expect(parcel).toEqual({ weightGrams: 900, template: 'small' });
  });

  it('should round a fractional total', () => {
    const weights = new Map([['v1', 133.4]]);
    const oneLine: AutoDispatchWorkLine[] = [
      { productVariantId: 'v1', totalQuantity: 1, cancelledQuantity: 0 },
    ];

    expect(resolveAutoDispatchParcel(oneLine, weights, {})).toEqual({ weightGrams: 133 });
  });
});

describe('resolveAutoDispatchRecipient', () => {
  it('should build a courier recipient with the full address', () => {
    const recipient = resolveAutoDispatchRecipient({
      address: makeAddress(),
      customerEmail: 'buyer@example.com',
      deliveryIntent: 'address',
    });

    expect(recipient).toEqual({
      firstName: 'Jan',
      lastName: 'Kowalski',
      email: 'buyer@example.com',
      phone: '+48123456789',
      address: {
        street: 'ul. Testowa 1',
        buildingNumber: 'ul. Testowa 1',
        city: 'Poznań',
        postCode: '61-001',
        countryCode: 'PL',
      },
    });
  });

  it('should build a pickup_point recipient with no address block', () => {
    const recipient = resolveAutoDispatchRecipient({
      address: makeAddress(),
      customerEmail: 'buyer@example.com',
      deliveryIntent: 'pickup_point',
    });

    expect(recipient?.address).toBeUndefined();
    expect(recipient?.email).toBe('buyer@example.com');
    expect(recipient?.phone).toBe('+48123456789');
  });

  it('should refuse when there is no customer email', () => {
    expect(
      resolveAutoDispatchRecipient({
        address: makeAddress(),
        customerEmail: undefined,
        deliveryIntent: 'pickup_point',
      }),
    ).toBeNull();
    expect(
      resolveAutoDispatchRecipient({
        address: makeAddress(),
        customerEmail: '   ',
        deliveryIntent: 'pickup_point',
      }),
    ).toBeNull();
  });

  it('should refuse when there is no phone, even for a pickup_point delivery', () => {
    expect(
      resolveAutoDispatchRecipient({
        address: makeAddress({ phone: undefined }),
        customerEmail: 'buyer@example.com',
        deliveryIntent: 'pickup_point',
      }),
    ).toBeNull();
  });

  it('should refuse a courier delivery missing any address field', () => {
    for (const field of ['address1', 'city', 'postalCode', 'country'] as const) {
      const address = makeAddress({ [field]: undefined });
      expect(
        resolveAutoDispatchRecipient({
          address,
          customerEmail: 'buyer@example.com',
          deliveryIntent: 'address',
        }),
      ).toBeNull();
    }
  });

  it('should refuse a courier delivery whose country is not a 2-letter ISO code', () => {
    expect(
      resolveAutoDispatchRecipient({
        address: makeAddress({ country: 'Poland' }),
        customerEmail: 'buyer@example.com',
        deliveryIntent: 'address',
      }),
    ).toBeNull();
  });

  it('should refuse a PII-redacted address rather than sending a half-formed recipient', () => {
    expect(
      resolveAutoDispatchRecipient({
        address: makeAddress({ address1: REDACTED_PLACEHOLDER }),
        customerEmail: 'buyer@example.com',
        deliveryIntent: 'address',
      }),
    ).toBeNull();
    expect(
      resolveAutoDispatchRecipient({
        address: makeAddress({ city: REDACTED_PLACEHOLDER }),
        customerEmail: 'buyer@example.com',
        deliveryIntent: 'pickup_point',
      }),
    ).toBeNull();
  });

  it('should refuse a pickup_point delivery with no address at all (no phone to read)', () => {
    expect(
      resolveAutoDispatchRecipient({
        address: undefined,
        customerEmail: 'buyer@example.com',
        deliveryIntent: 'pickup_point',
      }),
    ).toBeNull();
  });
});
