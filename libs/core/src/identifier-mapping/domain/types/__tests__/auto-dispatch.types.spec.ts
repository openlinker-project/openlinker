import {
  isPresentButInvalidAutoDispatchTrigger,
  readAutoDispatchConfig,
} from '../auto-dispatch.types';
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

const OFF = { enabled: false, trigger: 'on-accept' } as const;
const ON = { enabled: true, trigger: 'on-accept' } as const;

describe('readAutoDispatchConfig', () => {
  it('should return disabled when config is null or undefined', () => {
    expect(readAutoDispatchConfig(null)).toEqual(OFF);
    expect(readAutoDispatchConfig(undefined)).toEqual(OFF);
  });

  it('should return disabled when autoDispatch is absent', () => {
    expect(readAutoDispatchConfig({})).toEqual(OFF);
  });

  it('should return disabled when autoDispatch is not an object', () => {
    expect(readAutoDispatchConfig(cfg('yes'))).toEqual(OFF);
    expect(readAutoDispatchConfig(cfg(1))).toEqual(OFF);
    expect(readAutoDispatchConfig(cfg(null))).toEqual(OFF);
    expect(readAutoDispatchConfig(cfg([]))).toEqual(OFF);
  });

  it('should return disabled when enabled is not exactly true', () => {
    expect(readAutoDispatchConfig(cfg({ enabled: 'true' }))).toEqual(OFF);
    expect(readAutoDispatchConfig(cfg({ enabled: 1 }))).toEqual(OFF);
    expect(readAutoDispatchConfig({ autoDispatch: { enabled: false } })).toEqual(OFF);
    expect(readAutoDispatchConfig({ autoDispatch: {} })).toEqual(OFF);
  });

  it('should return enabled with no extras when only enabled is set', () => {
    expect(readAutoDispatchConfig({ autoDispatch: { enabled: true } })).toEqual(ON);
  });

  it('should keep a non-empty string parcelTemplate', () => {
    expect(
      readAutoDispatchConfig({ autoDispatch: { enabled: true, parcelTemplate: 'small' } })
    ).toEqual({ ...ON, parcelTemplate: 'small' });
  });

  it('should drop a blank or non-string parcelTemplate', () => {
    expect(
      readAutoDispatchConfig({ autoDispatch: { enabled: true, parcelTemplate: '   ' } })
    ).toEqual(ON);
    expect(readAutoDispatchConfig(cfg({ enabled: true, parcelTemplate: 42 }))).toEqual(ON);
  });

  it('should floor a fractional defaultWeightGrams', () => {
    expect(
      readAutoDispatchConfig({ autoDispatch: { enabled: true, defaultWeightGrams: 250.9 } })
    ).toEqual({ ...ON, defaultWeightGrams: 250 });
  });

  it('should drop a non-positive, non-finite or non-numeric defaultWeightGrams', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '250', null]) {
      expect(readAutoDispatchConfig(cfg({ enabled: true, defaultWeightGrams: bad }))).toEqual(ON);
    }
  });

  it('should keep both extras together', () => {
    expect(
      readAutoDispatchConfig({
        autoDispatch: { enabled: true, parcelTemplate: 'medium', defaultWeightGrams: 500 },
      })
    ).toEqual({ ...ON, parcelTemplate: 'medium', defaultWeightGrams: 500 });
  });

  it('should keep default dimensions only as a complete positive set (#3571)', () => {
    expect(
      readAutoDispatchConfig(cfg({ enabled: true, lengthMm: 300, widthMm: 200, heightMm: 100 }))
    ).toEqual({ ...ON, lengthMm: 300, widthMm: 200, heightMm: 100 });
    expect(readAutoDispatchConfig(cfg({ enabled: true, lengthMm: 300, widthMm: 200 }))).toEqual(ON);
    expect(
      readAutoDispatchConfig(cfg({ enabled: true, lengthMm: 300, widthMm: 200, heightMm: 0 }))
    ).toEqual(ON);
  });

  describe('trigger (#2729, D1)', () => {
    it('should read on-accept when no trigger is configured, so an existing connection is unchanged', () => {
      expect(readAutoDispatchConfig({ autoDispatch: { enabled: true } }).trigger).toBe('on-accept');
    });

    it('should keep a recognised trigger', () => {
      expect(
        readAutoDispatchConfig({ autoDispatch: { enabled: true, trigger: 'on-parcel-closed' } })
          .trigger
      ).toBe('on-parcel-closed');
      expect(
        readAutoDispatchConfig({ autoDispatch: { enabled: true, trigger: 'on-accept' } }).trigger
      ).toBe('on-accept');
    });

    it('should read on-accept for an unrecognised or non-string trigger', () => {
      for (const bad of ['on-close', '', 'ON-ACCEPT', 1, true, null, {}]) {
        expect(readAutoDispatchConfig(cfg({ enabled: true, trigger: bad })).trigger).toBe(
          'on-accept'
        );
      }
    });

    it('should still read disabled, with the default trigger, when enabled is not true', () => {
      expect(
        readAutoDispatchConfig(cfg({ enabled: false, trigger: 'on-parcel-closed' }))
      ).toEqual(OFF);
    });
  });
});

describe('isPresentButInvalidAutoDispatchTrigger', () => {
  it('should be false when there is nothing to be invalid', () => {
    expect(isPresentButInvalidAutoDispatchTrigger(null)).toBe(false);
    expect(isPresentButInvalidAutoDispatchTrigger(undefined)).toBe(false);
    expect(isPresentButInvalidAutoDispatchTrigger({})).toBe(false);
    expect(isPresentButInvalidAutoDispatchTrigger(cfg('yes'))).toBe(false);
    expect(isPresentButInvalidAutoDispatchTrigger(cfg({ enabled: true }))).toBe(false);
    expect(isPresentButInvalidAutoDispatchTrigger(cfg({ enabled: true, trigger: null }))).toBe(
      false
    );
  });

  it('should be false for a recognised trigger', () => {
    expect(
      isPresentButInvalidAutoDispatchTrigger(cfg({ enabled: true, trigger: 'on-parcel-closed' }))
    ).toBe(false);
  });

  it('should be true for a present value this build does not recognise', () => {
    expect(isPresentButInvalidAutoDispatchTrigger(cfg({ enabled: true, trigger: 'on-close' }))).toBe(
      true
    );
    expect(isPresentButInvalidAutoDispatchTrigger(cfg({ enabled: true, trigger: 5 }))).toBe(true);
  });
});
