import { readAutoDispatchConfig } from '../auto-dispatch.types';
import type { ConnectionConfig } from '../connection.types';

/**
 * Malformed-input tests need to pass shapes the typed `ConnectionConfig`
 * interface disallows on purpose (a string where an object is expected, and
 * so on) — the whole point being that `readAutoDispatchConfig` coerces them
 * defensively at runtime rather than trusting the type. This is the same
 * `as unknown as ConnectionConfig` escape the `stock-safety-buffer.types.spec.ts`
 * precedent uses per malformed value.
 */
function cfg(autoDispatch: unknown): ConnectionConfig {
  return { autoDispatch } as unknown as ConnectionConfig;
}

describe('readAutoDispatchConfig', () => {
  it('should return disabled when config is null or undefined', () => {
    expect(readAutoDispatchConfig(null)).toEqual({ enabled: false });
    expect(readAutoDispatchConfig(undefined)).toEqual({ enabled: false });
  });

  it('should return disabled when autoDispatch is absent', () => {
    expect(readAutoDispatchConfig({})).toEqual({ enabled: false });
  });

  it('should return disabled when autoDispatch is not an object', () => {
    expect(readAutoDispatchConfig(cfg('yes'))).toEqual({ enabled: false });
    expect(readAutoDispatchConfig(cfg(1))).toEqual({ enabled: false });
    expect(readAutoDispatchConfig(cfg(null))).toEqual({ enabled: false });
    expect(readAutoDispatchConfig(cfg([]))).toEqual({ enabled: false });
  });

  it('should return disabled when enabled is not exactly true', () => {
    expect(readAutoDispatchConfig(cfg({ enabled: 'true' }))).toEqual({ enabled: false });
    expect(readAutoDispatchConfig(cfg({ enabled: 1 }))).toEqual({ enabled: false });
    expect(readAutoDispatchConfig({ autoDispatch: { enabled: false } })).toEqual({
      enabled: false,
    });
    expect(readAutoDispatchConfig({ autoDispatch: {} })).toEqual({ enabled: false });
  });

  it('should return enabled with no extras when only enabled is set', () => {
    expect(readAutoDispatchConfig({ autoDispatch: { enabled: true } })).toEqual({
      enabled: true,
    });
  });

  it('should keep a non-empty string parcelTemplate', () => {
    expect(
      readAutoDispatchConfig({ autoDispatch: { enabled: true, parcelTemplate: 'small' } }),
    ).toEqual({ enabled: true, parcelTemplate: 'small' });
  });

  it('should drop a blank or non-string parcelTemplate', () => {
    expect(
      readAutoDispatchConfig({ autoDispatch: { enabled: true, parcelTemplate: '   ' } }),
    ).toEqual({ enabled: true });
    expect(readAutoDispatchConfig(cfg({ enabled: true, parcelTemplate: 42 }))).toEqual({
      enabled: true,
    });
  });

  it('should floor a fractional defaultWeightGrams', () => {
    expect(
      readAutoDispatchConfig({ autoDispatch: { enabled: true, defaultWeightGrams: 250.9 } }),
    ).toEqual({ enabled: true, defaultWeightGrams: 250 });
  });

  it('should drop a non-positive, non-finite or non-numeric defaultWeightGrams', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '250', null]) {
      expect(readAutoDispatchConfig(cfg({ enabled: true, defaultWeightGrams: bad }))).toEqual({
        enabled: true,
      });
    }
  });

  it('should keep both extras together', () => {
    expect(
      readAutoDispatchConfig({
        autoDispatch: { enabled: true, parcelTemplate: 'medium', defaultWeightGrams: 500 },
      }),
    ).toEqual({ enabled: true, parcelTemplate: 'medium', defaultWeightGrams: 500 });
  });
});
