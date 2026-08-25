import { describe, it, expect } from 'vitest';
import {
  clearReturnFilters,
  hasActiveReturnFilters,
  readReturnFilters,
  readReturnOffset,
  setReturnFilterParam,
  setReturnOffsetParam,
} from './returns-filters';

describe('readReturnFilters', () => {
  it('should read every declared filter when all are present', () => {
    const params = new URLSearchParams({
      bucket: 'orphan',
      sourceConnectionId: 'conn_1',
      createdFrom: '2026-01-01T00:00:00.000Z',
      createdTo: '2026-02-01T00:00:00.000Z',
    });

    expect(readReturnFilters(params)).toEqual({
      bucket: 'orphan',
      sourceConnectionId: 'conn_1',
      createdFrom: '2026-01-01T00:00:00.000Z',
      createdTo: '2026-02-01T00:00:00.000Z',
    });
  });

  it('should leave every filter undefined when no param is present', () => {
    expect(readReturnFilters(new URLSearchParams())).toEqual({
      bucket: undefined,
      sourceConnectionId: undefined,
      createdFrom: undefined,
      createdTo: undefined,
    });
  });

  it.each(['orphan', 'attributed'])('should accept the declared bucket %s', (bucket) => {
    expect(readReturnFilters(new URLSearchParams({ bucket })).bucket).toBe(bucket);
  });

  it('should ignore an unrecognised bucket rather than forwarding it', () => {
    // The API validates `bucket` with @IsIn, so forwarding a hand-edited value
    // would 400 the whole page over a typo in the URL bar.
    expect(readReturnFilters(new URLSearchParams({ bucket: 'declined' })).bucket).toBeUndefined();
    expect(readReturnFilters(new URLSearchParams({ bucket: '' })).bucket).toBeUndefined();
  });
});

describe('readReturnOffset', () => {
  it('should read a positive offset', () => {
    expect(readReturnOffset(new URLSearchParams({ offset: '40' }))).toBe(40);
  });

  it.each([
    ['absent', new URLSearchParams()],
    ['non-numeric', new URLSearchParams({ offset: 'abc' })],
    ['negative', new URLSearchParams({ offset: '-10' })],
  ])('should fall back to the first page when the offset is %s', (_label, params) => {
    expect(readReturnOffset(params)).toBe(0);
  });
});

describe('hasActiveReturnFilters', () => {
  it('should report no active filter for an unfiltered list', () => {
    expect(hasActiveReturnFilters(readReturnFilters(new URLSearchParams()))).toBe(false);
  });

  it.each(['bucket=orphan', 'sourceConnectionId=conn_1', 'createdFrom=2026-01-01', 'createdTo=2026-01-01'])(
    'should report an active filter for %s',
    (query) => {
      expect(hasActiveReturnFilters(readReturnFilters(new URLSearchParams(query)))).toBe(true);
    },
  );

  it('should NOT treat an offset as a filter', () => {
    // Load-bearing: paging past the end is a different operator situation from
    // filtering to nothing. Conflating them makes the list claim there are no
    // returns when there are.
    const params = new URLSearchParams({ offset: '999' });
    expect(hasActiveReturnFilters(readReturnFilters(params))).toBe(false);
  });

  it('should NOT treat an unrecognised bucket as a filter', () => {
    // It was already dropped by the guard, so the request is unfiltered — and
    // an empty result must reach the unfiltered branches, not "no matches".
    const params = new URLSearchParams({ bucket: 'nonsense' });
    expect(hasActiveReturnFilters(readReturnFilters(params))).toBe(false);
  });
});

describe('setReturnFilterParam', () => {
  it('should set a filter and reset the offset', () => {
    const next = setReturnFilterParam(new URLSearchParams({ offset: '40' }), 'bucket', 'orphan');
    expect(next.get('bucket')).toBe('orphan');
    expect(next.get('offset')).toBeNull();
  });

  it('should delete a filter on an empty value and still reset the offset', () => {
    const next = setReturnFilterParam(
      new URLSearchParams({ bucket: 'orphan', offset: '40' }),
      'bucket',
      '',
    );
    expect(next.get('bucket')).toBeNull();
    expect(next.get('offset')).toBeNull();
  });

  it('should not mutate the params it was given', () => {
    const params = new URLSearchParams({ bucket: 'orphan' });
    setReturnFilterParam(params, 'bucket', 'attributed');
    expect(params.get('bucket')).toBe('orphan');
  });

  it('should preserve params it does not own', () => {
    const next = setReturnFilterParam(new URLSearchParams({ sort: 'x' }), 'bucket', 'orphan');
    expect(next.get('sort')).toBe('x');
  });
});

describe('clearReturnFilters', () => {
  it('should drop every filter and the offset in one call', () => {
    const next = clearReturnFilters(
      new URLSearchParams({
        bucket: 'orphan',
        sourceConnectionId: 'conn_1',
        createdFrom: '2026-01-01',
        createdTo: '2026-02-01',
        offset: '40',
      }),
    );
    expect([...next.keys()]).toEqual([]);
  });

  it('should preserve params it does not own', () => {
    const next = clearReturnFilters(new URLSearchParams({ bucket: 'orphan', sort: 'x' }));
    expect(next.get('sort')).toBe('x');
    expect(next.get('bucket')).toBeNull();
  });
});

describe('setReturnOffsetParam', () => {
  it('should set a later page offset', () => {
    expect(setReturnOffsetParam(new URLSearchParams(), 20).get('offset')).toBe('20');
  });

  it.each([0, -5])('should drop the param entirely at offset %s', (offset) => {
    const next = setReturnOffsetParam(new URLSearchParams({ offset: '20' }), offset);
    expect(next.get('offset')).toBeNull();
  });

  it('should preserve the active filters while paging', () => {
    const next = setReturnOffsetParam(new URLSearchParams({ bucket: 'orphan' }), 20);
    expect(next.get('bucket')).toBe('orphan');
  });
});
