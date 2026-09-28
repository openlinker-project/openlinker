import { describe, expect, it } from 'vitest';
import { oldestAgeSuffix } from './oldest-age-suffix';

describe('oldestAgeSuffix', () => {
  it('renders an empty string for a null/undefined instant', () => {
    expect(oldestAgeSuffix(null)).toBe('');
    expect(oldestAgeSuffix(undefined)).toBe('');
  });

  it('renders an empty string for an unparseable instant', () => {
    expect(oldestAgeSuffix('not-a-date')).toBe('');
  });

  it('renders hours when the elapsed time is under a day', () => {
    const fourteenHoursAgo = new Date(Date.now() - 14 * 3_600_000).toISOString();
    expect(oldestAgeSuffix(fourteenHoursAgo)).toBe(' · oldest 14 h');
  });

  it('renders days once the elapsed time reaches a full day', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(oldestAgeSuffix(threeDaysAgo)).toBe(' · oldest 3 d');
  });

  it('renders an empty string for an instant under an hour ago', () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    expect(oldestAgeSuffix(thirtyMinutesAgo)).toBe('');
  });
});
