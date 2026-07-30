/**
 * Unit tests for deriveRetryabilityClass (#1918).
 */
import { describe, expect, it } from 'vitest';

import { deriveRetryabilityClass, RETRYABILITY_CLASS_VALUES, RETRYABILITY_LABEL } from './shipment-retryability';

describe('deriveRetryabilityClass', () => {
  it('returns unknown for a null providerCode', () => {
    expect(deriveRetryabilityClass(null)).toBe('unknown');
  });

  it('classifies api.http-5xx and 429 as transient', () => {
    expect(deriveRetryabilityClass('api.http-503')).toBe('transient');
    expect(deriveRetryabilityClass('api.http-500')).toBe('transient');
    expect(deriveRetryabilityClass('api.http-429')).toBe('transient');
  });

  it('classifies api.http-401/403 as auth', () => {
    expect(deriveRetryabilityClass('api.http-401')).toBe('auth');
    expect(deriveRetryabilityClass('api.http-403')).toBe('auth');
  });

  it('classifies other api.http-4xx as permanent', () => {
    expect(deriveRetryabilityClass('api.http-400')).toBe('permanent');
    expect(deriveRetryabilityClass('api.http-404')).toBe('permanent');
  });

  it('classifies preflight.*, command.*, and target_point as permanent', () => {
    expect(deriveRetryabilityClass('preflight.missing-parcel-template')).toBe('permanent');
    expect(deriveRetryabilityClass('command.success-without-shipment-id')).toBe('permanent');
    expect(deriveRetryabilityClass('target_point')).toBe('permanent');
  });

  it('classifies an opaque carrier-surfaced code as unknown', () => {
    expect(deriveRetryabilityClass('DELIVERY_METHOD_NOT_AVAILABLE')).toBe('unknown');
  });
});

describe('RETRYABILITY_LABEL', () => {
  it('has a label for every class value', () => {
    for (const value of RETRYABILITY_CLASS_VALUES) {
      expect(RETRYABILITY_LABEL[value]).toBeTruthy();
    }
  });
});
