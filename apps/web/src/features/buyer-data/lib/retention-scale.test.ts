import { describe, expect, it } from 'vitest';
import {
  AXIS_PCT,
  daysToPct,
  estimateZoneCounts,
  moveErase,
  moveHide,
  nextDetent,
  pctToDays,
  prevDetent,
  snapToDetent,
  zoneForAge,
} from './retention-scale';

describe('retention scale (#4289)', () => {
  it('should snap to the nearest detent and prefer the longer period on a tie', () => {
    expect(snapToDetent(100)).toBe(90);
    expect(snapToDetent(130)).toBe(90);
    expect(snapToDetent(135)).toBe(180);
    expect(snapToDetent(5000)).toBe(3650);
    expect(snapToDetent(1)).toBe(30);
  });

  it('should step through the detents and end on never', () => {
    expect(nextDetent(90)).toBe(180);
    expect(nextDetent(90, 2)).toBe(365);
    expect(nextDetent(3650)).toBe(0);
    expect(nextDetent(0)).toBe(0);
    expect(prevDetent(90)).toBe(60);
    expect(prevDetent(30)).toBe(30);
    expect(prevDetent(0)).toBe(3650);
    expect(prevDetent(75)).toBe(60);
  });

  it('should map ages to positions and back, with never past the axis', () => {
    expect(daysToPct(3650)).toBeCloseTo(AXIS_PCT);
    expect(daysToPct(0)).toBeGreaterThan(AXIS_PCT);
    expect(pctToDays(daysToPct(365))).toBe(365);
    expect(pctToDays(99)).toBe(0);
    expect(pctToDays(0)).toBe(30);
  });

  it('should allow single-day steps when fine', () => {
    expect(pctToDays(daysToPct(100), true)).toBe(100);
  });

  it('should classify an age by the cuts', () => {
    const cuts = { hideAfterDays: 90, eraseAfterDays: 365 };
    expect(zoneForAge(89, cuts)).toBe('kept');
    expect(zoneForAge(90, cuts)).toBe('hidden');
    expect(zoneForAge(365, cuts)).toBe('erased');
    expect(zoneForAge(5000, { hideAfterDays: 0, eraseAfterDays: 0 })).toBe('kept');
    expect(zoneForAge(400, { hideAfterDays: 0, eraseAfterDays: 365 })).toBe('erased');
  });

  it('should push erase out when hide passes it, and clamp erase to hide', () => {
    expect(moveHide({ hideAfterDays: 90, eraseAfterDays: 180 }, 365)).toEqual({
      hideAfterDays: 365,
      eraseAfterDays: 365,
      moved: true,
    });
    expect(moveHide({ hideAfterDays: 90, eraseAfterDays: 0 }, 365).moved).toBe(false);
    expect(moveHide({ hideAfterDays: 90, eraseAfterDays: 180 }, 0).moved).toBe(false);
    expect(moveErase({ hideAfterDays: 365, eraseAfterDays: 730 }, 90)).toEqual({
      hideAfterDays: 365,
      eraseAfterDays: 365,
      moved: true,
    });
    expect(moveErase({ hideAfterDays: 365, eraseAfterDays: 730 }, 0).eraseAfterDays).toBe(0);
  });

  it('should estimate zone counts from the histogram', () => {
    const buckets = [
      { ageMonths: 0, visible: 10, hidden: 0, erased: 0 },
      { ageMonths: 4, visible: 5, hidden: 2, erased: 0 },
      { ageMonths: 14, visible: 1, hidden: 1, erased: 1 },
    ];
    expect(estimateZoneCounts(buckets, { hideAfterDays: 90, eraseAfterDays: 365 })).toEqual({
      kept: 10,
      hidden: 7,
      erased: 3,
    });
  });
});
