/**
 * Bench work ordering (#2416, `W3b-3`, story B2)
 */
import { compareBenchWork, type BenchOrderingInput } from '../bench-work-ordering';

function row(over: Partial<BenchOrderingInput> = {}): BenchOrderingInput {
  return { expeditedAt: null, dispatchByAt: null, workId: 'w-1', ...over };
}

const at = (iso: string): Date => new Date(iso);

describe('compareBenchWork (#2416)', () => {
  it('should sort an expedited parcel ahead of one due sooner', () => {
    // The whole point of D22: somebody's decision outranks the deadline.
    const expedited = row({ workId: 'a', expeditedAt: at('2026-09-04T09:00:00Z') });
    const urgent = row({ workId: 'b', dispatchByAt: at('2026-09-04T10:00:00Z') });

    expect([urgent, expedited].sort(compareBenchWork).map((r) => r.workId)).toEqual(['a', 'b']);
  });

  it('should order two expedited parcels first-pushed-first', () => {
    // Which is why the flag is an instant rather than a boolean.
    const first = row({ workId: 'a', expeditedAt: at('2026-09-04T09:00:00Z') });
    const second = row({ workId: 'b', expeditedAt: at('2026-09-04T09:30:00Z') });

    expect([second, first].sort(compareBenchWork).map((r) => r.workId)).toEqual(['a', 'b']);
  });

  it('should sort by deadline, soonest first', () => {
    const soon = row({ workId: 'a', dispatchByAt: at('2026-09-04T12:00:00Z') });
    const later = row({ workId: 'b', dispatchByAt: at('2026-09-05T12:00:00Z') });

    expect([later, soon].sort(compareBenchWork).map((r) => r.workId)).toEqual(['a', 'b']);
  });

  it('should sort a parcel with NO deadline LAST', () => {
    // Unknown is not urgent. Sorting it to the front would push real, dated
    // deadlines down the screen — the one direction that costs a dispatch.
    const dated = row({ workId: 'a', dispatchByAt: at('2026-09-08T12:00:00Z') });
    const undated = row({ workId: 'b', dispatchByAt: null });

    expect([undated, dated].sort(compareBenchWork).map((r) => r.workId)).toEqual(['a', 'b']);
  });

  it('should keep an expedited parcel first even with no deadline at all', () => {
    const expedited = row({ workId: 'a', expeditedAt: at('2026-09-04T09:00:00Z') });
    const dated = row({ workId: 'b', dispatchByAt: at('2026-09-04T10:00:00Z') });

    expect([dated, expedited].sort(compareBenchWork).map((r) => r.workId)).toEqual(['a', 'b']);
  });

  it('should be a TOTAL order, so two reads of an unchanged list agree', () => {
    // Without the id tiebreak two parcels sharing a deadline can swap places
    // between polls, and a list that shuffles under a packer is one they stop
    // trusting — the same failure D22 names for a different cause.
    const shared = at('2026-09-04T12:00:00Z');
    const rows = [
      row({ workId: 'c', dispatchByAt: shared }),
      row({ workId: 'a', dispatchByAt: shared }),
      row({ workId: 'b', dispatchByAt: shared }),
    ];

    expect([...rows].sort(compareBenchWork).map((r) => r.workId)).toEqual(['a', 'b', 'c']);
    expect([...rows].reverse().sort(compareBenchWork).map((r) => r.workId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
