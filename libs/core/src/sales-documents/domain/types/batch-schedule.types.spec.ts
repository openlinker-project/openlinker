/**
 * Batch schedule rules (#3583)
 *
 * Instants are written in UTC; Europe/Warsaw is UTC+1 in winter and UTC+2 in
 * summer, which is what the DST cases pin.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import {
  findDueBatchSlots,
  findNextBatchSlots,
  readBatchSchedule,
  type BatchSchedule,
} from './batch-schedule.types';

const schedule = (overrides: Partial<BatchSchedule>): BatchSchedule => ({
  frequency: 'daily',
  time: '18:00',
  everyHours: 24,
  timeZone: 'Europe/Warsaw',
  effectiveFrom: new Date(0),
  ...overrides,
});

const iso = (slots: { slotAt: Date; segment: string }[]): string[] =>
  slots.map((s) => `${s.segment}@${s.slotAt.toISOString()}`);

describe('readBatchSchedule', () => {
  it('should return null when the kind has no readable frequency', () => {
    expect(readBatchSchedule({}, 'invoice')).toBeNull();
    expect(readBatchSchedule('oops', 'invoice')).toBeNull();
    expect(
      readBatchSchedule({ salesDocument: { batchSchedules: { invoice: { frequency: 'weekly' } } } }, 'invoice'),
    ).toBeNull();
  });

  it('should read the schedule of the asked kind only', () => {
    const config = {
      salesDocument: {
        batchSchedules: {
          invoice: { frequency: 'month-end' },
          'fiscal-receipt': { frequency: 'daily', time: '09:30', timeZone: 'Europe/London' },
        },
      },
    };
    expect(readBatchSchedule(config, 'invoice')?.frequency).toBe('month-end');
    expect(readBatchSchedule(config, 'fiscal-receipt')).toMatchObject({
      frequency: 'daily',
      time: '09:30',
      timeZone: 'Europe/London',
    });
  });

  it('should default an unreadable time, interval, zone and effectiveFrom', () => {
    const read = readBatchSchedule(
      {
        salesDocument: {
          batchSchedules: {
            invoice: { frequency: 'every-n-hours', time: '25:00', everyHours: 0, timeZone: 'Mars/Base', effectiveFrom: 'x' },
          },
        },
      },
      'invoice',
    );
    expect(read).toEqual({
      frequency: 'every-n-hours',
      time: '18:00',
      everyHours: 24,
      timeZone: 'Europe/Warsaw',
      effectiveFrom: new Date(0),
    });
  });
});

describe('findDueBatchSlots', () => {
  it('should return today 18:00 Warsaw once it has passed (winter, UTC+1)', () => {
    const now = new Date('2026-01-15T17:30:00Z'); // 18:30 Warsaw
    expect(iso(findDueBatchSlots(schedule({}), now))).toEqual(['all@2026-01-15T17:00:00.000Z']);
  });

  it("should return yesterday's slot before today's time (summer, UTC+2)", () => {
    const now = new Date('2026-07-15T15:00:00Z'); // 17:00 Warsaw
    expect(iso(findDueBatchSlots(schedule({}), now))).toEqual(['all@2026-07-14T16:00:00.000Z']);
  });

  it('should keep 18:00 wall-clock across the spring DST change', () => {
    // 29 Mar 2026 is the CET -> CEST switch; 18:00 that day is 16:00Z.
    const now = new Date('2026-03-29T16:01:00Z');
    expect(iso(findDueBatchSlots(schedule({}), now))).toEqual(['all@2026-03-29T16:00:00.000Z']);
  });

  it('should not fire a slot before effectiveFrom', () => {
    const now = new Date('2026-01-15T18:30:00Z');
    expect(
      findDueBatchSlots(schedule({ effectiveFrom: new Date('2026-01-15T18:00:00Z') }), now),
    ).toEqual([]);
  });

  it('should step every N hours from 00:00', () => {
    const now = new Date('2026-01-15T13:10:00Z'); // 14:10 Warsaw
    expect(
      iso(findDueBatchSlots(schedule({ frequency: 'every-n-hours', everyHours: 6 }), now)),
    ).toEqual(['all@2026-01-15T11:00:00.000Z']); // 12:00 Warsaw
  });

  it('should issue B2B at month end and B2C daily for a month-end schedule (D42)', () => {
    // 1 Feb 2026 00:30 Warsaw: January's last day 23:00 has just passed.
    const now = new Date('2026-01-31T23:30:00Z');
    expect(iso(findDueBatchSlots(schedule({ frequency: 'month-end' }), now))).toEqual([
      'b2b@2026-01-31T22:00:00.000Z',
      'b2c@2026-01-31T22:00:00.000Z',
    ]);
  });

  it('should use the previous month end mid-month, and a leap February', () => {
    const now = new Date('2028-03-10T12:00:00Z');
    const slots = findDueBatchSlots(schedule({ frequency: 'month-end' }), now);
    expect(iso(slots)[0]).toBe('b2b@2028-02-29T22:00:00.000Z');
  });
});

describe('findNextBatchSlots', () => {
  it('should return the next daily slot after now', () => {
    const now = new Date('2026-01-15T17:30:00Z');
    expect(iso(findNextBatchSlots(schedule({}), now))).toEqual(['all@2026-01-16T17:00:00.000Z']);
  });
});
