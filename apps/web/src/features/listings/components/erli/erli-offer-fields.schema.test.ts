/**
 * Erli offer-field schema + helper unit tests (#1096)
 */
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../../connections';
import {
  ERLI_DEFAULT_DISPATCH,
  formatDispatch,
  isValidDispatch,
  parseErliConnectionDispatchDefault,
  toDispatchTimeParam,
} from './erli-offer-fields.schema';

function connectionWithConfig(config: Record<string, unknown>): Connection {
  return { config } as unknown as Connection;
}

describe('isValidDispatch', () => {
  it('accepts a non-negative integer period with a valid unit', () => {
    expect(isValidDispatch({ period: 2, unit: 'day' })).toBe(true);
    expect(isValidDispatch({ period: 0, unit: 'hour' })).toBe(true);
  });

  it('rejects negative, non-integer, or out-of-bound periods', () => {
    expect(isValidDispatch({ period: -1, unit: 'day' })).toBe(false);
    expect(isValidDispatch({ period: 1.5, unit: 'day' })).toBe(false);
    expect(isValidDispatch({ period: 25, unit: 'hour' })).toBe(false); // hour ≤ 24
    expect(isValidDispatch({ period: 13, unit: 'month' })).toBe(false); // month ≤ 12
  });

  it('rejects non-object / unknown unit', () => {
    expect(isValidDispatch(null)).toBe(false);
    expect(isValidDispatch({ period: 2, unit: 'week' })).toBe(false);
  });
});

describe('parseErliConnectionDispatchDefault', () => {
  it('returns the configured default when valid', () => {
    expect(
      parseErliConnectionDispatchDefault(
        connectionWithConfig({ defaultDispatchTime: { period: 3, unit: 'day' } }).config,
      ),
    ).toEqual({ period: 3, unit: 'day' });
  });

  it('defaults the unit to day when omitted', () => {
    expect(
      parseErliConnectionDispatchDefault(
        connectionWithConfig({ defaultDispatchTime: { period: 5 } }).config,
      ),
    ).toEqual({ period: 5, unit: 'day' });
  });

  it('falls back to ERLI_DEFAULT_DISPATCH for a missing / malformed config', () => {
    expect(parseErliConnectionDispatchDefault({})).toEqual(ERLI_DEFAULT_DISPATCH);
    expect(
      parseErliConnectionDispatchDefault({ defaultDispatchTime: { period: -2 } }),
    ).toEqual(ERLI_DEFAULT_DISPATCH);
    expect(
      parseErliConnectionDispatchDefault({ defaultDispatchTime: 'nonsense' as unknown }),
    ).toEqual(ERLI_DEFAULT_DISPATCH);
  });
});

describe('toDispatchTimeParam', () => {
  it('maps form values to the wire param', () => {
    expect(toDispatchTimeParam({ dispatchPeriod: 4, dispatchUnit: 'hour' })).toEqual({
      period: 4,
      unit: 'hour',
    });
  });
});

describe('formatDispatch', () => {
  it('pluralises by period + unit', () => {
    expect(formatDispatch({ period: 1, unit: 'day' })).toBe('1 working day');
    expect(formatDispatch({ period: 2, unit: 'day' })).toBe('2 working days');
    expect(formatDispatch({ period: 1, unit: 'hour' })).toBe('1 hour');
    expect(formatDispatch({ period: 3, unit: 'month' })).toBe('3 months');
  });
});
