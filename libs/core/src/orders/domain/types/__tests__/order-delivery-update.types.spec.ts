import { computeDeliveryFingerprint } from '../order-delivery-update.types';

describe('computeDeliveryFingerprint', () => {
  it('should be stable for the same delivery point', () => {
    const a = computeDeliveryFingerprint({ pickupPoint: { id: 'WAW14A', name: 'Paczkomat' } });
    const b = computeDeliveryFingerprint({ pickupPoint: { id: 'WAW14A', name: 'Paczkomat' } });
    expect(a).toBe(b);
  });

  it('should ignore surrounding whitespace', () => {
    expect(computeDeliveryFingerprint({ pickupPoint: { id: ' WAW14A ' } })).toBe(
      computeDeliveryFingerprint({ pickupPoint: { id: 'WAW14A' } })
    );
  });

  it('should differ when the locker, name, description or method changes', () => {
    const base = { shipping: { methodId: 'm1' }, pickupPoint: { id: 'WAW14A', name: 'n', description: 'd' } };
    const fp = computeDeliveryFingerprint(base);
    expect(computeDeliveryFingerprint({ ...base, pickupPoint: { ...base.pickupPoint, id: 'KRK01M' } })).not.toBe(fp);
    expect(computeDeliveryFingerprint({ ...base, pickupPoint: { ...base.pickupPoint, name: 'x' } })).not.toBe(fp);
    expect(computeDeliveryFingerprint({ ...base, pickupPoint: { ...base.pickupPoint, description: 'x' } })).not.toBe(fp);
    expect(computeDeliveryFingerprint({ ...base, shipping: { methodId: 'm2' } })).not.toBe(fp);
  });

  it('should differ between a locker and no locker', () => {
    expect(computeDeliveryFingerprint({ pickupPoint: { id: 'WAW14A' } })).not.toBe(computeDeliveryFingerprint({}));
  });
});
