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
      from: '2026-09-19T00:00:00.000Z',
      to: '2026-09-26T23:59:59.999Z',
      productVariantId: 'v1',
    });
    expect(hasActiveMovementFilters(state)).toBe(true);
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
