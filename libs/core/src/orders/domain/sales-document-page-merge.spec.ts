import { mergeSalesDocumentPages, type MergeCandidate, type SourcePage } from './sales-document-page-merge';

type Source = 'a' | 'b';

interface Item extends MergeCandidate<Source> {
  label: string;
}

function item(source: Source, createdAt: string, id: string): Item {
  return { source, createdAt: new Date(createdAt), id, label: `${source}:${id}` };
}

function page(items: Item[], ownNextCursor: SourcePage<Source, Item>['ownNextCursor']): SourcePage<Source, Item> {
  return { items, ownNextCursor };
}

describe('mergeSalesDocumentPages', () => {
  it('interleaves both sources newest-first', () => {
    const result = mergeSalesDocumentPages<Source, Item>(
      {
        a: page([item('a', '2026-01-03T00:00:00Z', 'a3'), item('a', '2026-01-01T00:00:00Z', 'a1')], null),
        b: page([item('b', '2026-01-02T00:00:00Z', 'b2')], null),
      },
      { a: undefined, b: undefined },
      10,
    );

    expect(result.items.map((i) => i.label)).toEqual(['a:a3', 'b:b2', 'a:a1']);
  });

  it('truncates to limit and derives the correct resume point per source', () => {
    const result = mergeSalesDocumentPages<Source, Item>(
      {
        a: page(
          [item('a', '2026-01-05T00:00:00Z', 'a5'), item('a', '2026-01-02T00:00:00Z', 'a2')],
          { createdAt: new Date('2026-01-02T00:00:00Z'), id: 'a2' },
        ),
        b: page(
          [item('b', '2026-01-04T00:00:00Z', 'b4'), item('b', '2026-01-03T00:00:00Z', 'b3')],
          { createdAt: new Date('2026-01-03T00:00:00Z'), id: 'b3' },
        ),
      },
      { a: undefined, b: undefined },
      3,
    );

    // Sorted: a5, b4, b3, a2 -> truncated to 3: a5, b4, b3
    expect(result.items.map((i) => i.label)).toEqual(['a:a5', 'b:b4', 'b:b3']);
    // 'a' contributed a5 only (its last CONSUMED row) - a2 was fetched but not consumed.
    expect(result.nextCursor.a).toEqual({ createdAt: new Date('2026-01-05T00:00:00Z'), id: 'a5' });
    // 'b' contributed both fetched rows - resume after the last one.
    expect(result.nextCursor.b).toEqual({ createdAt: new Date('2026-01-03T00:00:00Z'), id: 'b3' });
  });

  it('marks a source with zero fetched rows as exhausted (null)', () => {
    const result = mergeSalesDocumentPages<Source, Item>(
      {
        a: page([item('a', '2026-01-01T00:00:00Z', 'a1')], null),
        b: page([], null),
      },
      { a: undefined, b: undefined },
      10,
    );

    // 'b' returned nothing at all -> exhausted.
    expect(result.nextCursor.b).toBeNull();
    // 'a' had one row and it WAS consumed (limit=10 easily fits it) -> resume
    // after it, not null - only an EMPTY fetch means exhausted.
    expect(result.nextCursor.a).toEqual({ createdAt: new Date('2026-01-01T00:00:00Z'), id: 'a1' });
  });

  it('never coerces an un-consumed-but-non-empty source to null on a first page (the regression this file exists to prevent)', () => {
    // Source 'a' has real rows, but ALL of them are older than everything 'b'
    // returned, so none of 'a's rows survive truncation to limit=1. If the
    // merge wrongly reported `nextCursor.a = null`, the next page would never
    // look at 'a' again and its rows would be silently lost forever.
    const result = mergeSalesDocumentPages<Source, Item>(
      {
        a: page([item('a', '2026-01-01T00:00:00Z', 'a1')], null),
        b: page([item('b', '2026-01-10T00:00:00Z', 'b10')], { createdAt: new Date('2026-01-10T00:00:00Z'), id: 'b10' }),
      },
      { a: undefined, b: undefined },
      1,
    );

    expect(result.items.map((i) => i.label)).toEqual(['b:b10']);
    // 'a' was fetched (non-empty) but contributed nothing to this page ->
    // resume from where it was fetched FROM, i.e. `undefined` (start), NOT `null`.
    expect(result.nextCursor.a).toBeUndefined();
  });

  it('preserves an in-progress (non-first-page) cursor for an un-consumed source rather than resetting it', () => {
    const priorCursor = { createdAt: new Date('2026-01-01T00:00:00Z'), id: 'a1' };
    const result = mergeSalesDocumentPages<Source, Item>(
      {
        a: page([item('a', '2025-06-01T00:00:00Z', 'a0')], null),
        b: page([item('b', '2026-01-10T00:00:00Z', 'b10')], { createdAt: new Date('2026-01-10T00:00:00Z'), id: 'b10' }),
      },
      { a: priorCursor, b: undefined },
      1,
    );

    expect(result.nextCursor.a).toBe(priorCursor);
  });

  it('breaks ties by id descending when createdAt is identical', () => {
    const result = mergeSalesDocumentPages<Source, Item>(
      {
        a: page([item('a', '2026-01-01T00:00:00Z', 'zzz')], null),
        b: page([item('b', '2026-01-01T00:00:00Z', 'aaa')], null),
      },
      { a: undefined, b: undefined },
      10,
    );

    expect(result.items.map((i) => i.label)).toEqual(['a:zzz', 'b:aaa']);
  });
});
