/**
 * Bench presentation rules (#2416, `W3b-3`, stories B2/B4/B5)
 */
import { describe, expect, it } from 'vitest';

import type { BenchWork } from '../api/bench-work.types';
import {
  describeBenchDeadline,
  expediteActionFor,
  groupBenchWork,
  matchesBenchSearch,
  normaliseReference,
  sectionOf,
} from './bench-work-presentation';
import { benchWorkCopy } from './bench-work.copy';

function work(over: Partial<BenchWork> = {}): BenchWork {
  return {
    workId: 'w-1',
    version: 3,
    orderId: 'ol_order_1',
    orderReference: 'OL-4471',
    buyerName: 'Jan Wiśniewski',
    dispatchByAt: null,
    parcelIndex: 1,
    parcelTotal: 1,
    lineCount: 2,
    unitsToVerify: 3,
    state: 'packable',
    holdReason: null,
    holdPlacedAt: null,
    expeditedAt: null,
    supportedActions: ['expedite'],
    ...over,
  };
}

describe('sectionOf / groupBenchWork (#2416, story B4)', () => {
  it('should put a packable parcel in the packing section', () => {
    expect(sectionOf(work())).toBe('to-pack');
  });

  it('should put held and cancelled parcels in their own section', () => {
    expect(sectionOf(work({ state: 'held' }))).toBe('do-not-pack');
    expect(sectionOf(work({ state: 'cancelled' }))).toBe('do-not-pack');
  });

  it('should treat an UNRECOGNISED state as do-not-pack', () => {
    // The safe direction: a value this build cannot vouch for costs a question
    // if it is wrong, where the other reading costs a parcel that should not
    // have gone out.
    expect(sectionOf(work({ state: 'quarantined_by_a_future_release' }))).toBe('do-not-pack');
  });

  it('should split the list while preserving the server order within each section', () => {
    const rows = [
      work({ workId: 'a' }),
      work({ workId: 'b', state: 'held' }),
      work({ workId: 'c' }),
    ];
    const { toPack, doNotPack } = groupBenchWork(rows);
    expect(toPack.map((row) => row.workId)).toEqual(['a', 'c']);
    expect(doNotPack.map((row) => row.workId)).toEqual(['b']);
  });
});

describe('describeBenchDeadline (#2416, story B2)', () => {
  const now = new Date('2026-09-04T10:00:00Z');

  it('should say a deadline is past rather than showing a bare negative', () => {
    const view = describeBenchDeadline('2026-09-04T08:00:00Z', now);
    expect(view.headline).toBe(benchWorkCopy.row.deadlineOverdue);
    expect(view.level).toBe('overdue');
  });

  it('should mark a deadline inside the day as close', () => {
    const view = describeBenchDeadline('2026-09-04T14:00:00Z', now);
    expect(view.headline).toBe(benchWorkCopy.row.deadlineSoon);
    // The remainder comes from the shared `formatShipBy`, not from a second
    // arithmetic here — that reuse is the point.
    expect(view.remaining).toBe('4h left');
  });

  it('should state an ABSENT deadline rather than rendering nothing', () => {
    // "must go today" and "nobody told us when this goes" are different facts,
    // and a blank conflates them.
    const view = describeBenchDeadline(null, now);
    expect(view.headline).toBe(benchWorkCopy.row.deadlineUnknown);
    expect(view.remaining).toBeNull();
    expect(view.level).toBeNull();
  });

  it('should never phrase a deadline as readiness', () => {
    for (const iso of ['2026-09-04T08:00:00Z', '2026-09-04T14:00:00Z', '2026-09-08T14:00:00Z']) {
      expect(describeBenchDeadline(iso, now).headline.toLowerCase()).not.toContain('ready');
    }
  });
});

describe('matchesBenchSearch (#2416, D11)', () => {
  it('should match the bare number the placeholder teaches', () => {
    expect(matchesBenchSearch(work(), '4471')).toBe(true);
  });

  it('should match a marketplace prefix and a differently-punctuated reference', () => {
    expect(matchesBenchSearch(work({ orderReference: 'allegro-4471' }), 'OL 4471')).toBe(true);
    expect(matchesBenchSearch(work(), 'ol4471')).toBe(true);
  });

  it("should match the buyer's surname", () => {
    expect(matchesBenchSearch(work(), 'wiśniewski')).toBe(true);
  });

  it('should not match an unrelated query', () => {
    expect(matchesBenchSearch(work(), '9999')).toBe(false);
  });

  it('should match everything when the field is empty or blank', () => {
    expect(matchesBenchSearch(work(), '')).toBe(true);
    expect(matchesBenchSearch(work(), '   ')).toBe(true);
  });

  it('should not crash on a parcel with no buyer name', () => {
    expect(matchesBenchSearch(work({ buyerName: null }), 'nowak')).toBe(false);
  });
});

describe('normaliseReference (#2416)', () => {
  it('should fold case and drop punctuation', () => {
    expect(normaliseReference('OL-4471')).toBe('ol4471');
    expect(normaliseReference('  allegro / 4471 ')).toBe('allegro4471');
  });
});

describe('expediteActionFor (#2416, story B5)', () => {
  it('should offer whichever verb the SERVER named, never one derived from the flag', () => {
    expect(expediteActionFor(work({ supportedActions: ['expedite'] }))).toBe('expedite');
    expect(expediteActionFor(work({ supportedActions: ['release_expedite'] }))).toBe(
      'release_expedite'
    );
  });

  it('should offer nothing on a parcel the server gave no actions for', () => {
    // A cancelled parcel is terminal, so it carries `[]` — including no
    // expedite. Deriving the direction from `expeditedAt` would have offered a
    // control the server would then refuse.
    expect(expediteActionFor(work({ state: 'cancelled', supportedActions: [] }))).toBeNull();
    expect(
      expediteActionFor(work({ expeditedAt: '2026-09-04T09:00:00Z', supportedActions: [] }))
    ).toBeNull();
  });
});
