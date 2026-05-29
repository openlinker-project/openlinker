/**
 * ShippingProviderRejectionException — closed-core contract spec (#885).
 *
 * The base-class contract every shipping adapter throws across. Documents
 * what plugins inherit by throwing this — message-verbatim, optional
 * providerDetails, stable `name` field, captured stack — so a future plugin
 * author can read the spec to learn the closed-core surface.
 */
import { ShippingProviderRejectionException } from '../shipping-provider-rejection.exception';

describe('ShippingProviderRejectionException', () => {
  it('should expose providerName + providerCode + message verbatim (no prefix)', () => {
    const error = new ShippingProviderRejectionException(
      'inpost',
      'target_point',
      'locker POZ08A unavailable',
    );

    expect(error.providerName).toBe('inpost');
    expect(error.providerCode).toBe('target_point');
    expect(error.message).toBe('locker POZ08A unavailable');
  });

  it('should make providerDetails optional', () => {
    const error = new ShippingProviderRejectionException('inpost', null, 'reason');

    expect(error.providerDetails).toBeUndefined();
  });

  it('should expose providerDetails as an open-shape Record<string, unknown>', () => {
    const error = new ShippingProviderRejectionException(
      'inpost',
      'target_point',
      'unavailable',
      { paczkomatId: 'POZ08A', fieldErrors: { target_point: ['invalid'] } },
    );

    expect(error.providerDetails).toEqual({
      paczkomatId: 'POZ08A',
      fieldErrors: { target_point: ['invalid'] },
    });
  });

  it('should have a stable `name` field for log filtering', () => {
    const error = new ShippingProviderRejectionException('allegro', null, 'reason');

    expect(error.name).toBe('ShippingProviderRejectionException');
  });

  it('should capture a stack trace', () => {
    const error = new ShippingProviderRejectionException('allegro', null, 'reason');

    expect(typeof error.stack).toBe('string');
    expect(error.stack ?? '').toContain('ShippingProviderRejectionException');
  });
});
