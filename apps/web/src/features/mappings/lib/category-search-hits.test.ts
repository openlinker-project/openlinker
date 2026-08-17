/**
 * Category search hit adapters — tests (#2075)
 *
 * @module apps/web/src/features/mappings/lib
 */
import { describe, expect, it } from 'vitest';

import { toCategorySearchResultHits, isTaxonomyUnsynced } from './category-search-hits';
import type { CategorySearchHit } from '../api/mappings.types';

const HIT: CategorySearchHit = {
  category: { id: '258066', name: 'Smartfony', parentId: '258060', leaf: true },
  path: [
    { id: '258060', name: 'Telefony' },
    { id: '258066', name: 'Smartfony' },
  ],
};

describe('toCategorySearchResultHits', () => {
  it('should flatten a hit into the primitive shape, preserving its path', () => {
    expect(toCategorySearchResultHits([HIT])).toEqual([
      {
        id: '258066',
        name: 'Smartfony',
        leaf: true,
        path: [
          { id: '258060', name: 'Telefony' },
          { id: '258066', name: 'Smartfony' },
        ],
      },
    ]);
  });

  it('should treat undefined (query still loading) as empty', () => {
    expect(toCategorySearchResultHits(undefined)).toEqual([]);
  });
});

describe('isTaxonomyUnsynced', () => {
  const synced = {
    atRoot: true,
    browsedNodeCount: 0,
    isBrowseLoading: false,
    browseError: null,
  };

  it('should report unsynced at root with an empty, successful browse', () => {
    expect(isTaxonomyUnsynced(synced)).toBe(true);
  });

  it('should NOT report unsynced when the browse failed', () => {
    // The regression this exists for: a failed browse also leaves zero nodes.
    // Calling that "never synced" tells the operator something false about
    // their own catalogue — the exact defect class #2075 removes. It must fall
    // through to the weaker "no matches" claim instead.
    expect(isTaxonomyUnsynced({ ...synced, browseError: new Error('network') })).toBe(false);
  });

  it('should NOT report unsynced while the browse is still loading', () => {
    expect(isTaxonomyUnsynced({ ...synced, isBrowseLoading: true })).toBe(false);
  });

  it('should NOT report unsynced below the root, where the tree has content', () => {
    expect(isTaxonomyUnsynced({ ...synced, atRoot: false })).toBe(false);
  });

  it('should NOT report unsynced when the level has nodes', () => {
    expect(isTaxonomyUnsynced({ ...synced, browsedNodeCount: 3 })).toBe(false);
  });
});
