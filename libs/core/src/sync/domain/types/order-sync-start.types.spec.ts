/**
 * Order Sync Start Intent Unit Tests (#4228)
 */
import {
  describeInvalidOrderSyncStartDate,
  parseOrderSyncStart,
  resolveOrderSyncStartModes,
  serializeOrderSyncStart,
} from './order-sync-start.types';

const NOW = new Date('2026-11-18T12:00:00.000Z');

describe('order sync start intent', () => {
  describe('serialize / parse', () => {
    it.each([
      [{ mode: 'now' as const }],
      [{ mode: 'all' as const }],
      [{ mode: 'from' as const, from: '2026-01-01' }],
    ])('should round-trip %j', (start) => {
      expect(parseOrderSyncStart(serializeOrderSyncStart(start))).toEqual(start);
    });

    it.each([
      [null],
      [undefined],
      [''],
      ['not json'],
      ['[]'],
      ['{"mode":"later"}'],
      ['{"mode":"from"}'],
      ['{"mode":"from","from":" "}'],
    ])('should return null when the stored value is %p', (raw) => {
      expect(parseOrderSyncStart(raw)).toBeNull();
    });
  });

  describe('describeInvalidOrderSyncStartDate', () => {
    it('should accept a bare date and an instant inside the window', () => {
      expect(describeInvalidOrderSyncStartDate('2026-10-01', NOW)).toBeNull();
      expect(describeInvalidOrderSyncStartDate('2026-10-01T08:00:00Z', NOW)).toBeNull();
    });

    it('should refuse an unparseable value', () => {
      expect(describeInvalidOrderSyncStartDate('yesterday', NOW)).toMatch(/ISO date/);
      expect(describeInvalidOrderSyncStartDate(undefined, NOW)).toMatch(/ISO date/);
    });

    it('should refuse a future date', () => {
      expect(describeInvalidOrderSyncStartDate('2026-11-19', NOW)).toMatch(/future/);
    });

    it('should refuse a date older than five years', () => {
      expect(describeInvalidOrderSyncStartDate('2021-11-17', NOW)).toMatch(/5 years/);
      expect(describeInvalidOrderSyncStartDate('2021-11-19', NOW)).toBeNull();
    });
  });

  it('should default the supported modes to now and all', () => {
    expect(resolveOrderSyncStartModes(undefined)).toEqual(['now', 'all']);
    expect(resolveOrderSyncStartModes(['now', 'from', 'all'])).toEqual(['now', 'from', 'all']);
  });
});
