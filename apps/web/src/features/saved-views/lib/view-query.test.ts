import { describe, expect, it } from 'vitest';
import {
  applyQueryToParams,
  canonicalQuery,
  encodeSort,
  filterEntries,
  hasViewState,
  parseSort,
  readSort,
  resolveNonViewParams,
  writeSort,
} from './view-query';
import type { SortCodec } from './view-registry.types';

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

  it('should add a registry\'s extra non-view params to the default list', () => {
    const resolved = resolveNonViewParams({ extraNonViewParams: ['peek'] });
    expect(resolved).toContain('peek');
    expect(resolved).toContain('page');
    expect(resolveNonViewParams({})).toContain('sort');
  });

  describe('with a sort codec', () => {
    // Two params, as Orders spells it: the engine must read and write through the page's own form.
    const twoParams: SortCodec = {
      parse: (params) => {
        const key = params.get('sort');
        if (key === null) return null;
        return { key, dir: params.get('dir') === 'asc' ? 'asc' : 'desc' };
      },
      write: (params, sort) => {
        params.delete('sort');
        params.delete('dir');
        if (!sort) return;
        params.set('sort', sort.key);
        params.set('dir', sort.dir);
      },
    };

    it('should read the sort through the codec instead of the key:dir spelling', () => {
      expect(readSort(new URLSearchParams('sort=total&dir=asc'), twoParams)).toEqual({ key: 'total', dir: 'asc' });
      expect(readSort(new URLSearchParams('sort=total&dir=asc'))).toEqual({ key: 'total', dir: 'desc' });
    });

    it('should write the sort through the codec and remove what it owns for none', () => {
      const params = new URLSearchParams('stage=failed');
      writeSort(params, { key: 'total', dir: 'asc' }, twoParams);
      expect(params.toString()).toBe('stage=failed&sort=total&dir=asc');
      writeSort(params, null, twoParams);
      expect(params.toString()).toBe('stage=failed');
    });

    it('should apply a view over the address in the page\'s spelling and keep its own direction param out of the filters', () => {
      const next = applyQueryToParams(
        new URLSearchParams('stage=old&sort=created&dir=asc&q=mug'),
        { query: 'gift=1', sort: { key: 'total', dir: 'desc' } },
        resolveNonViewParams({ extraNonViewParams: ['dir'] }),
        twoParams,
      );
      expect(next.get('sort')).toBe('total');
      expect(next.get('dir')).toBe('desc');
      expect(next.get('q')).toBe('mug');
      expect(next.get('stage')).toBeNull();
      expect(next.get('gift')).toBe('1');
    });

    it('should treat a lone direction as a deep link only when the codec says it carries a sort', () => {
      const nonView = resolveNonViewParams({ extraNonViewParams: ['dir'] });
      expect(hasViewState(new URLSearchParams('sort=total&dir=asc'), nonView, twoParams)).toBe(true);
      expect(hasViewState(new URLSearchParams('dir=asc'), nonView, twoParams)).toBe(false);
      expect(hasViewState(new URLSearchParams('offset=20'), nonView, twoParams)).toBe(false);
    });
  });
});
