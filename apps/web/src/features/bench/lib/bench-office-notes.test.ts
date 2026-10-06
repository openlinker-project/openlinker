/**
 * Notes from the office - presentation (D12, scenario G03-6)
 *
 * Every instant is built in LOCAL time and `now` is passed explicitly, so the
 * calendar-day arithmetic is asserted the same way in any zone the suite runs.
 */
import { describe, expect, it } from 'vitest';

import { formatAbsoluteTime, formatDateTime } from '../../../shared/format/format-date';
import type { BenchPackerNote } from '../api/bench-parcel.types';
import { describeBenchNoteTime, orderBenchOfficeNotes } from './bench-office-notes';

const local = (day: number, hour: number, minute = 0): string =>
  new Date(2026, 8, day, hour, minute).toISOString();

describe('describeBenchNoteTime', () => {
  const now = new Date(2026, 8, 30, 15, 0);

  it('should say today with the clock time when the note is from earlier today', () => {
    const iso = local(30, 12, 40);
    expect(describeBenchNoteTime(iso, now)).toEqual({
      label: `today ${formatAbsoluteTime(iso)}`,
      full: formatDateTime(iso),
    });
  });

  it('should say yesterday when the note crossed midnight minutes ago', () => {
    const iso = local(29, 23, 50);
    const justAfterMidnight = new Date(2026, 8, 30, 0, 10);
    expect(describeBenchNoteTime(iso, justAfterMidnight).label).toBe(
      `yesterday ${formatAbsoluteTime(iso)}`
    );
  });

  it('should fall to the absolute date when the note is two or more days old', () => {
    const iso = local(28, 9, 0);
    expect(describeBenchNoteTime(iso, now)).toEqual({
      label: formatDateTime(iso),
      full: formatDateTime(iso),
    });
  });

  it('should not claim today when the note is stamped later than the bench clock', () => {
    const iso = local(30, 16, 0);
    expect(describeBenchNoteTime(iso, now).label).toBe(formatDateTime(iso));
  });

  it('should show the raw value when the timestamp does not parse', () => {
    expect(describeBenchNoteTime('not-a-date', now)).toEqual({
      label: 'not-a-date',
      full: 'not-a-date',
    });
  });
});

describe('orderBenchOfficeNotes', () => {
  const note = (id: string, createdAt: string): BenchPackerNote => ({
    id,
    body: id,
    authorUsername: 'marta.nowak',
    createdAt,
  });

  it('should put the newest first without reordering the input array', () => {
    const input = [note('a', local(28, 9)), note('b', local(30, 9)), note('c', local(29, 9))];
    const ordered = orderBenchOfficeNotes(input);

    expect(ordered.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('should keep the API order for ties and sink an unparseable time to the end', () => {
    const same = local(30, 9);
    const ordered = orderBenchOfficeNotes([
      note('bad', 'garbage'),
      note('first', same),
      note('second', same),
    ]);

    expect(ordered.map((n) => n.id)).toEqual(['first', 'second', 'bad']);
  });
});
