import { describe, expect, it } from 'vitest';
import {
  applyQueryToParams,
  canonicalQuery,
  encodeSort,
  filterEntries,
  hasViewState,
  parseSort,
} from './view-query';

describe('view query', () => {
  it('should parse and encode a sort', () => {
    expect(parseSort('total:asc')).toEqual({ key: 'total', dir: 'asc' });
    expect(parseSort('total')).toEqual({ key: 'total', dir: 'desc' });
    expect(parseSort(null)).toBeNull();
    expect(encodeSort({ key: 'total', dir: 'desc' })).toBe('total:desc');
  });

  it('should leave search text and paging out of a view', () => {
    expect(filterEntries('stage=failed&q=mug&page=3&sort=total:asc&view=x')).toEqual([['stage', 'failed']]);
  });

  it('should drop empty values', () => {
    expect(filterEntries('stage=&gift=1')).toEqual([['gift', '1']]);
  });

  it('should canonicalise the order of filters', () => {
    expect(canonicalQuery('b=2&a=1')).toBe('a=1&b=2');
  });

  it('should write filters and sort over the address and keep search text', () => {
    const next = applyQueryToParams(new URLSearchParams('stage=ready&q=mug&page=4'), {
      query: 'gift=1',
      sort: { key: 'total', dir: 'asc' },
    });
    expect(next.get('q')).toBe('mug');
    expect(next.get('gift')).toBe('1');
    expect(next.get('stage')).toBeNull();
    expect(next.get('sort')).toBe('total:asc');
  });

  it('should restart paging when a view is applied', () => {
    const next = applyQueryToParams(new URLSearchParams('page=4&offset=40'), { query: '', sort: null });
    expect(next.has('page')).toBe(false);
    expect(next.has('offset')).toBe(false);
  });

  it('should recognise a deep link by its filters or its sort', () => {
    expect(hasViewState(new URLSearchParams('stage=failed'))).toBe(true);
    expect(hasViewState(new URLSearchParams('sort=total:asc'))).toBe(true);
    expect(hasViewState(new URLSearchParams('q=mug&page=2'))).toBe(false);
  });
});
