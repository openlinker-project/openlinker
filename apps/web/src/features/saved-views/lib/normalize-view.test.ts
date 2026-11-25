import { describe, expect, it } from 'vitest';
import { decodeStoredQuery, forStorage } from './normalize-view';
import type { ViewDefinition } from './saved-view.types';
import { testRegistry } from './saved-views.fixtures';
import type { ListRegistry } from './view-registry.types';
import type { TestRow } from './saved-views.fixtures';

const definition: ViewDefinition = { v: 1, query: 'invoicing=blocked&stage=failed', sort: null, columns: [], parts: {} };

describe('stored query codec', () => {
  const registry: ListRegistry<TestRow> = {
    ...testRegistry,
    storedQuery: {
      encode: (query) => query.replace('invoicing=blocked', 'salesDocumentBlocked=true'),
      decode: (query) => query.replace('salesDocumentBlocked=true', 'invoicing=blocked'),
    },
  };

  it('should leave the query untouched when the page declares no codec', () => {
    expect(forStorage(testRegistry, definition).query).toBe(definition.query);
    expect(decodeStoredQuery(testRegistry, definition).query).toBe(definition.query);
  });

  it('should store the query in the spelling the list endpoint validates and read it back as the address spells it', () => {
    const stored = forStorage(registry, definition);
    expect(stored.query).toBe('salesDocumentBlocked=true&stage=failed');
    expect(decodeStoredQuery(registry, stored).query).toBe(definition.query);
  });
});
