import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { useOrderListFilters } from './use-order-list-filters';

function setup(initial: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[`/orders${initial}`]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => {
      const api = useOrderListFilters();
      const location = useLocation();
      return { api, search: location.search };
    },
    { wrapper },
  );
}

const params = (search: string): URLSearchParams => new URLSearchParams(search);

describe('useOrderListFilters', () => {
  it('should write the source param and drop the page offset when a filter changes', () => {
    const { result } = setup('?offset=40');
    act(() => {
      result.current.api.setFilter('sourceConnectionId', 'conn-1');
    });
    const p = params(result.current.search);
    expect(p.get('sourceConnectionId')).toBe('conn-1');
    expect(p.get('offset')).toBeNull();
  });

  it('should write packed=false when "Not packed yet" is chosen', () => {
    const { result } = setup('');
    act(() => {
      result.current.api.setFilter('packed', 'false');
    });
    expect(params(result.current.search).get('packed')).toBe('false');
    expect(result.current.api.filters.packed).toBe(false);
  });

  it('should flip a present-only toggle on and off when toggled twice', () => {
    const { result } = setup('');
    act(() => {
      result.current.api.toggle('salesDocumentBlocked');
    });
    expect(params(result.current.search).get('invoicing')).toBe('blocked');
    act(() => {
      result.current.api.toggle('salesDocumentBlocked');
    });
    expect(params(result.current.search).get('invoicing')).toBeNull();
  });

  it('should clear both tag params in one write when a tag chip is removed', () => {
    const { result } = setup('?tag=t1&untagged=true&health=synced');
    act(() => {
      result.current.api.clear(['tag', 'untagged']);
    });
    const p = params(result.current.search);
    expect(p.get('tag')).toBeNull();
    expect(p.get('untagged')).toBeNull();
    expect(p.get('health')).toBe('synced');
  });

  it('should clear every filter but keep the sort when Clear all is used', () => {
    const { result } = setup(
      '?sourceConnectionId=c&createdFrom=2026-09-01&due=breaching&tag=t&search=kulus&phase=ready&sort=total&dir=asc&offset=20',
    );
    act(() => {
      result.current.api.clearAll();
    });
    const p = params(result.current.search);
    expect([...p.keys()].sort()).toEqual(['dir', 'sort']);
    expect(result.current.api.searchInput).toBe('');
  });

  it('should replace one tag with the untagged axis when the tag filter changes', () => {
    const { result } = setup('?tag=t1');
    act(() => {
      result.current.api.setTagFilter({ untagged: true });
    });
    const p = params(result.current.search);
    expect(p.get('tag')).toBeNull();
    expect(p.get('untagged')).toBe('true');
  });

  it('should clear the phase when the active phase is selected again', () => {
    const { result } = setup('?phase=ready');
    act(() => {
      result.current.api.togglePhase('ready');
    });
    expect(params(result.current.search).get('phase')).toBeNull();
  });

  it('should keep the offset when paging', () => {
    const { result } = setup('?health=synced');
    act(() => {
      result.current.api.setOffset(20);
    });
    const p = params(result.current.search);
    expect(p.get('offset')).toBe('20');
    expect(p.get('health')).toBe('synced');
  });

  it('should flip direction when the active sort column is clicked again', () => {
    const { result } = setup('');
    expect(result.current.api.sort).toBe('dispatchBy');
    expect(result.current.api.dir).toBe('asc');
    act(() => {
      result.current.api.applySort('dispatchBy');
    });
    expect(result.current.api.dir).toBe('desc');
  });

  it('should report active filters for search alone when only search is set', () => {
    const { result } = setup('?search=kulus');
    expect(result.current.api.hasActiveFilters).toBe(true);
    expect(result.current.api.activeKeys).toEqual(['search']);
  });
});
