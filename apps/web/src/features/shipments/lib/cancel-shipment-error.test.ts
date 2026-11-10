import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { canRetryCancelShipment, classifyCancelShipmentError } from './cancel-shipment-error';

describe('classifyCancelShipmentError', () => {
  it('should classify a 502 carrying a providerCode as carrier-refused', () => {
    const error = new ApiError('x', 502, { message: 'x', providerCode: 'shipx.invalid_action' });
    expect(classifyCancelShipmentError(error)).toBe('carrier-refused');
  });

  it('should classify a 502 without a providerCode as failed', () => {
    // Expired carrier credentials and a proxy 502 must not read as a refusal.
    expect(classifyCancelShipmentError(new ApiError('x', 502, 'Unauthorized'))).toBe('failed');
    expect(classifyCancelShipmentError(new ApiError('x', 502, null))).toBe('failed');
  });

  it.each([
    [409, 'no-longer-active'],
    [422, 'not-supported'],
    [500, 'failed'],
    [0, 'failed'],
  ] as const)('should classify a %i as %s', (status, kind) => {
    expect(classifyCancelShipmentError(new ApiError('x', status, null))).toBe(kind);
  });

  it('should classify a non-API error as failed', () => {
    expect(classifyCancelShipmentError(new Error('boom'))).toBe('failed');
  });
});

describe('canRetryCancelShipment', () => {
  it('should offer a retry only when another attempt could change the answer', () => {
    expect(canRetryCancelShipment('carrier-refused')).toBe(true);
    expect(canRetryCancelShipment('failed')).toBe(true);
    expect(canRetryCancelShipment('no-longer-active')).toBe(false);
    expect(canRetryCancelShipment('not-supported')).toBe(false);
  });
});
