/**
 * Unit tests for deriveRetryabilityClass (#1918).
 *
 * @module libs/core/src/shipping/domain
 */
import { deriveRetryabilityClass } from './provider-code-retryability';

describe('deriveRetryabilityClass', () => {
  it('should return unknown for a null providerCode', () => {
    expect(deriveRetryabilityClass(null)).toBe('unknown');
  });

  it('should classify api.http-5xx and 429 as transient', () => {
    expect(deriveRetryabilityClass('api.http-503')).toBe('transient');
    expect(deriveRetryabilityClass('api.http-500')).toBe('transient');
    expect(deriveRetryabilityClass('api.http-429')).toBe('transient');
  });

  it('should classify api.http-401/403 as auth', () => {
    expect(deriveRetryabilityClass('api.http-401')).toBe('auth');
    expect(deriveRetryabilityClass('api.http-403')).toBe('auth');
  });

  it('should classify other api.http-4xx as permanent', () => {
    expect(deriveRetryabilityClass('api.http-400')).toBe('permanent');
    expect(deriveRetryabilityClass('api.http-404')).toBe('permanent');
    expect(deriveRetryabilityClass('api.http-422')).toBe('permanent');
  });

  it('should classify preflight.* codes as permanent', () => {
    expect(deriveRetryabilityClass('preflight.missing-parcel-template')).toBe('permanent');
    expect(deriveRetryabilityClass('preflight.missing-paczkomat-id')).toBe('permanent');
  });

  it('should classify command.* codes as permanent', () => {
    expect(deriveRetryabilityClass('command.success-without-shipment-id')).toBe('permanent');
  });

  it('should classify target_point as permanent', () => {
    expect(deriveRetryabilityClass('target_point')).toBe('permanent');
  });

  it('should classify an opaque carrier-surfaced code as unknown', () => {
    expect(deriveRetryabilityClass('DELIVERY_METHOD_NOT_AVAILABLE')).toBe('unknown');
    expect(deriveRetryabilityClass('PARCEL_TOO_LARGE')).toBe('unknown');
  });

  it('should not misclassify a malformed api.http code', () => {
    expect(deriveRetryabilityClass('api.http-abc')).toBe('unknown');
    expect(deriveRetryabilityClass('api.http-')).toBe('unknown');
  });
});
