import { describe, expect, it } from 'vitest';
import { ORDER_RANGE_DEFAULT_VALUE, toOrderImportPayload, validateOrderRange } from './order-range';

const NOW = new Date(2026, 10, 19, 12, 0, 0);

describe('validateOrderRange', () => {
  it('should require the first day', () => {
    expect(validateOrderRange(ORDER_RANGE_DEFAULT_VALUE, NOW).from).toBe('fromRequired');
  });

  it('should accept a past day with no last day', () => {
    expect(validateOrderRange({ ...ORDER_RANGE_DEFAULT_VALUE, from: '2026-10-01' }, NOW)).toEqual(
      {}
    );
  });

  it('should refuse a malformed, future or too old first day', () => {
    expect(validateOrderRange({ ...ORDER_RANGE_DEFAULT_VALUE, from: '2026-13-40' }, NOW).from).toBe(
      'fromInvalid'
    );
    expect(validateOrderRange({ ...ORDER_RANGE_DEFAULT_VALUE, from: '2026-11-20' }, NOW).from).toBe(
      'future'
    );
    expect(validateOrderRange({ ...ORDER_RANGE_DEFAULT_VALUE, from: '2021-01-01' }, NOW).from).toBe(
      'fromTooOld'
    );
  });

  it('should refuse a last day before the first or in the future', () => {
    expect(
      validateOrderRange(
        { ...ORDER_RANGE_DEFAULT_VALUE, from: '2026-10-10', to: '2026-10-09' },
        NOW
      ).to
    ).toBe('toBeforeFrom');
    expect(
      validateOrderRange(
        { ...ORDER_RANGE_DEFAULT_VALUE, from: '2026-10-10', to: '2026-12-01' },
        NOW
      ).to
    ).toBe('future');
  });
});

describe('toOrderImportPayload', () => {
  it('should send the run id, the days and the direction, and omit an empty last day', () => {
    expect(
      toOrderImportPayload({ from: '2026-10-01', to: '', direction: 'newest-first' }, 'run-1')
    ).toEqual({
      schemaVersion: 1,
      runId: 'run-1',
      from: '2026-10-01',
      direction: 'newest-first',
      cursor: null,
      page: 1,
    });
    expect(
      toOrderImportPayload({ from: '2026-10-01', to: '2026-10-03', direction: 'oldest-first' }, 'r')
    ).toMatchObject({ to: '2026-10-03' });
  });
});
