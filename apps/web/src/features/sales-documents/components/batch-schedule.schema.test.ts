import { describe, expect, it } from 'vitest';
import {
  batchScheduleSchema,
  toBatchScheduleConfig,
  toBatchScheduleFormValues,
} from './batch-schedule.schema';

const NOW = new Date('2026-11-02T10:00:00.000Z');

describe('batchScheduleSchema', () => {
  it('should accept a daily schedule', () => {
    const result = batchScheduleSchema.safeParse({
      frequency: 'daily',
      time: '18:00',
      everyHours: '4',
      timeZone: 'Europe/Warsaw',
    });
    expect(result.success).toBe(true);
  });

  it('should refuse a time that is not HH:MM and an hour count out of range', () => {
    expect(
      batchScheduleSchema.safeParse({
        frequency: 'daily',
        time: '25:00',
        everyHours: '4',
        timeZone: 'UTC',
      }).success
    ).toBe(false);
    expect(
      batchScheduleSchema.safeParse({
        frequency: 'every-n-hours',
        time: '',
        everyHours: '0',
        timeZone: 'UTC',
      }).success
    ).toBe(false);
  });

  it('should refuse a time zone Intl does not know', () => {
    expect(
      batchScheduleSchema.safeParse({
        frequency: 'month-end',
        time: '',
        everyHours: '',
        timeZone: 'Mars/Olympus',
      }).success
    ).toBe(false);
  });
});

describe('toBatchScheduleConfig', () => {
  it('should store only the fields its frequency reads, effective from now', () => {
    expect(
      toBatchScheduleConfig(
        { frequency: 'daily', time: '18:00', everyHours: '4', timeZone: 'Europe/Warsaw' },
        NOW
      )
    ).toEqual({
      frequency: 'daily',
      time: '18:00',
      timeZone: 'Europe/Warsaw',
      effectiveFrom: NOW.toISOString(),
    });
    expect(
      toBatchScheduleConfig(
        { frequency: 'every-n-hours', time: '18:00', everyHours: '6', timeZone: 'UTC' },
        NOW
      )
    ).toEqual({
      frequency: 'every-n-hours',
      everyHours: 6,
      timeZone: 'UTC',
      effectiveFrom: NOW.toISOString(),
    });
  });
});

describe('toBatchScheduleFormValues', () => {
  it('should default an unscheduled kind to daily at 18:00 in Europe/Warsaw', () => {
    expect(toBatchScheduleFormValues(undefined)).toEqual({
      frequency: 'daily',
      time: '18:00',
      everyHours: '4',
      timeZone: 'Europe/Warsaw',
    });
  });
});
