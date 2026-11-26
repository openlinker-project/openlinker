/**
 * Amazon order window policy tests (#4262)
 */
import { OrderSyncStartUnavailableError } from '@openlinker/core/orders';

import {
  amazonOrderWindowSlice,
  decodeAmazonOrderWindowCursor,
  encodeAmazonOrderWindowCursor,
  nextAmazonWindowSlice,
  parseAmazonStartDate,
  resolveAmazonOrderWindow,
} from '../amazon-order-window.policy';

const NOW = new Date('2026-11-25T12:00:00.000Z');

describe('amazon order window policy', () => {
  it('should read a bare day in UTC and an instant as it is', () => {
    expect(parseAmazonStartDate('2026-03-01', 'start', 'x')).toBe(Date.parse('2026-03-01T00:00:00.000Z'));
    expect(parseAmazonStartDate('2026-03-01', 'end', 'x')).toBe(Date.parse('2026-03-01T23:59:59.000Z'));
    expect(parseAmazonStartDate('2026-03-01T10:00:00Z', 'start', 'x')).toBe(Date.parse('2026-03-01T10:00:00Z'));
  });

  it('should refuse a value that is not a date with the typed start error', () => {
    expect(() => parseAmazonStartDate('nope', 'start', 'x')).toThrow(OrderSyncStartUnavailableError);
  });

  it('should clamp the upper bound to two minutes before now and refuse an inverted range', () => {
    const window = resolveAmazonOrderWindow({ from: '2026-11-01', to: '2027-01-01' }, NOW);
    expect(window.toMs).toBe(NOW.getTime() - 2 * 60 * 1000);
    expect(() => resolveAmazonOrderWindow({ from: '2026-11-20', to: '2026-11-10' }, NOW)).toThrow(
      OrderSyncStartUnavailableError,
    );
  });

  it('should cut a window into disjoint slices that cover it', () => {
    const window = resolveAmazonOrderWindow({ from: '2026-04-01', to: '2026-06-30' }, NOW);
    expect(window.sliceCount).toBe(4);
    const slices = Array.from({ length: window.sliceCount }, (_, i) => amazonOrderWindowSlice(window, i));
    for (let i = 1; i < slices.length; i += 1) {
      expect(Date.parse(slices[i].createdAfter)).toBeGreaterThan(Date.parse(slices[i - 1].createdBefore));
    }
    expect(slices[0].createdAfter).toBe('2026-04-01T00:00:00.000Z');
    expect(slices[3].createdBefore).toBe('2026-06-30T23:59:59.000Z');
  });

  it('should walk slices in either direction and end after the last one', () => {
    const window = resolveAmazonOrderWindow({ from: '2026-04-01', to: '2026-06-30' }, NOW);
    expect(nextAmazonWindowSlice(window, 0, false)).toBe(1);
    expect(nextAmazonWindowSlice(window, 3, false)).toBeNull();
    expect(nextAmazonWindowSlice(window, 3, true)).toBe(2);
    expect(nextAmazonWindowSlice(window, 0, true)).toBeNull();
  });

  it('should refuse a cursor it did not write instead of restarting the walk', () => {
    const window = resolveAmazonOrderWindow({ from: '2026-04-01', to: '2026-06-30' }, NOW);
    expect(() => decodeAmazonOrderWindowCursor('%%', window, false, NOW)).toThrow(OrderSyncStartUnavailableError);
    expect(() => decodeAmazonOrderWindowCursor('{"slice":99}', window, false, NOW)).toThrow(
      OrderSyncStartUnavailableError,
    );
  });

  it('should drop a pagination token older than a day and keep a fresh one', () => {
    const window = resolveAmazonOrderWindow({ from: '2026-04-01', to: '2026-06-30' }, NOW);
    const stale = encodeAmazonOrderWindowCursor({ slice: 1, paginationToken: 't', tokenIssuedAt: '2026-11-20T00:00:00Z' });
    const fresh = encodeAmazonOrderWindowCursor({ slice: 1, paginationToken: 't', tokenIssuedAt: NOW.toISOString() });
    expect(decodeAmazonOrderWindowCursor(stale, window, false, NOW)).toEqual({ slice: 1 });
    expect(decodeAmazonOrderWindowCursor(fresh, window, false, NOW).paginationToken).toBe('t');
  });
});
