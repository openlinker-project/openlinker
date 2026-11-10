import { invoiceIdempotencyKey, invoiceRetryRootKey } from './invoice-idempotency-key.types';

describe('invoice-idempotency-key.types (#3960)', () => {
  it('should keep attempt 0 byte-identical to the pre-attempt key', () => {
    expect(invoiceIdempotencyKey('conn-1', 'order-1')).toBe('invoice:conn-1:order-1');
  });

  it('should suffix later attempts', () => {
    expect(invoiceIdempotencyKey('conn-1', 'order-1', 2)).toBe('invoice:conn-1:order-1:r2');
  });

  it('should root a keyless refused record on the same shape a keyed chain uses', () => {
    const keyless = invoiceRetryRootKey({
      idempotencyKey: null,
      connectionId: 'conn-1',
      orderId: 'order-1',
      attempt: 0,
    });
    const keyed = invoiceRetryRootKey({
      idempotencyKey: invoiceIdempotencyKey('conn-1', 'order-1'),
      connectionId: 'conn-1',
      orderId: 'order-1',
      attempt: 0,
    });

    expect(keyless).toBe(keyed);
  });

  it('should strip the attempt suffix from a later attempt so the chain keeps one root', () => {
    expect(
      invoiceRetryRootKey({
        idempotencyKey: 'invoice:conn-1:order-1:r1',
        connectionId: 'conn-1',
        orderId: 'order-1',
        attempt: 1,
      }),
    ).toBe('invoice:conn-1:order-1');
  });

  it('should not strip a caller-chosen key that merely ends like a suffix on a first attempt', () => {
    expect(
      invoiceRetryRootKey({ idempotencyKey: 'custom:r7', connectionId: 'c', orderId: 'o', attempt: 0 }),
    ).toBe('custom:r7');
  });
});
