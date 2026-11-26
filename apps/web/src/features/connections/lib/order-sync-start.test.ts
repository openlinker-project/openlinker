import { describe, expect, it } from 'vitest';
import { describeOrderSyncStart, earliestOrderSyncStartDate } from './order-sync-start';

const copy = {
  now: 'New orders only',
  all: 'Every order',
  from: 'From {date}',
  newestFirst: 'newest first',
};
const format = (iso: string): string => `fmt(${iso})`;

describe('describeOrderSyncStart', () => {
  it('should describe the default when nothing is chosen', () => {
    expect(describeOrderSyncStart(undefined, copy, format)).toBe('New orders only');
    expect(describeOrderSyncStart({ mode: 'all' }, copy, format)).toBe('Every order');
  });

  it('should format a valid past date', () => {
    expect(describeOrderSyncStart({ mode: 'from', from: '2024-03-02' }, copy, format)).toBe(
      'From fmt(2024-03-02T12:00:00)'
    );
  });

  it('should not echo a future, malformed or empty date as the choice', () => {
    expect(describeOrderSyncStart({ mode: 'from', from: '2999-01-01' }, copy, format)).toBe(
      'From …'
    );
    expect(describeOrderSyncStart({ mode: 'from', from: '2024-13-40' }, copy, format)).toBe(
      'From …'
    );
    expect(describeOrderSyncStart({ mode: 'from', from: '' }, copy, format)).toBe('From …');
  });
});

describe('describeOrderSyncStart order suffix', () => {
  it('should append the newest-first suffix to a whole-history and a dated choice only', () => {
    expect(describeOrderSyncStart({ mode: 'all', order: 'newest-first' }, copy, format)).toBe(
      'Every order · newest first'
    );
    expect(
      describeOrderSyncStart(
        { mode: 'from', from: '2024-03-02', order: 'newest-first' },
        copy,
        format
      )
    ).toBe('From fmt(2024-03-02T12:00:00) · newest first');
    expect(describeOrderSyncStart({ mode: 'now', order: 'newest-first' }, copy, format)).toBe(
      'New orders only'
    );
  });

  it('should show the placeholder, still suffixed, for an unusable date', () => {
    expect(
      describeOrderSyncStart(
        { mode: 'from', from: '2999-01-01', order: 'newest-first' },
        copy,
        format
      )
    ).toBe('From … · newest first');
  });
});

describe('earliestOrderSyncStartDate', () => {
  it('should be five years back plus one day', () => {
    expect(earliestOrderSyncStartDate(new Date(2026, 10, 23))).toBe('2021-11-24');
  });

  it('should roll over a month end', () => {
    expect(earliestOrderSyncStartDate(new Date(2026, 10, 30))).toBe('2021-12-01');
  });
});
