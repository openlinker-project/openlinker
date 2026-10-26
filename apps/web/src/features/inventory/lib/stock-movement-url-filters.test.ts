import { describe, expect, it } from 'vitest';
import {
  hasActiveMovementFilters,
  readMovementUrlState,
  toMovementFilters,
} from './stock-movement-url-filters';

describe('stock movement URL filters', () => {
  it('should map an empty URL to no filters', () => {
    const state = readMovementUrlState(new URLSearchParams());
    expect(hasActiveMovementFilters(state)).toBe(false);
    expect(toMovementFilters(state)).toEqual({
      productVariantId: undefined,
      reasons: undefined,
      sourceConnectionId: undefined,
      from: undefined,
      to: undefined,
      needsAttention: undefined,
      kind: 'all',
      search: undefined,
    });
  });

  it('should round-trip every filter into the API filters', () => {
    const state = readMovementUrlState(
      new URLSearchParams('search=KUB&type=return_restock&master=c1&from=2026-09-19&to=2026-09-26&productVariantId=v1'),
    );
    expect(toMovementFilters(state)).toMatchObject({
      search: 'KUB',
      reasons: ['return_restock'],
      kind: 'movements',
      sourceConnectionId: 'c1',
      from: new Date(2026, 8, 19, 0, 0, 0, 0).toISOString(),
      to: new Date(2026, 8, 26, 23, 59, 59, 999).toISOString(),
      productVariantId: 'v1',
    });
    expect(hasActiveMovementFilters(state)).toBe(true);
  });

  it('should bound the day by the local calendar, so 23:30 local on the To day is included', () => {
    const filters = toMovementFilters(readMovementUrlState(new URLSearchParams('from=2026-09-26&to=2026-09-26')));
    const lateEvening = new Date(2026, 8, 26, 23, 30).getTime();
    const justBefore = new Date(2026, 8, 25, 23, 59, 59, 999).getTime();
    const nextMorning = new Date(2026, 8, 27, 0, 0, 0, 0).getTime();

    expect(new Date(filters.to as string).getTime()).toBeGreaterThanOrEqual(lateEvening);
    expect(new Date(filters.to as string).getTime()).toBeLessThan(nextMorning);
    expect(new Date(filters.from as string).getTime()).toBeGreaterThan(justBefore);
    expect(new Date(filters.from as string).getTime()).toBeLessThanOrEqual(lateEvening);
  });

  it('should treat the reservation type and the promised chip as the promised kind', () => {
    expect(toMovementFilters(readMovementUrlState(new URLSearchParams('type=reservation'))).kind).toBe('promised');
    expect(toMovementFilters(readMovementUrlState(new URLSearchParams('chip=promised'))).kind).toBe('promised');
  });

  it('should set needsAttention for the attention chip and ignore junk params', () => {
    const state = readMovementUrlState(new URLSearchParams('chip=attention&type=bogus&from=yesterday&offset=-4'));
    expect(toMovementFilters(state).needsAttention).toBe(true);
    expect(state.type).toBe('');
    expect(state.from).toBe('');
    expect(state.offset).toBe(0);
  });
});
