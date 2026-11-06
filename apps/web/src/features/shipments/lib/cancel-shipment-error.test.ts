import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { canRetryCancelShipment, classifyCancelShipmentError } from './cancel-shipment-error';

describe('classifyCancelShipmentError', () => {
  it.each([
    [502, 'carrier-refused'],
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
