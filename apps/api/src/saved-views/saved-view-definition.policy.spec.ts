import { InvalidSavedViewError, type SavedViewDefinition } from '@openlinker/core/saved-views';
import {
  SAVED_VIEW_PAGES,
  SAVED_VIEW_PAGE_KEYS,
  SAVED_VIEW_PAGE_KEY_FORMAT,
} from './saved-view-page-keys';
import { SavedViewDefinitionPolicy } from './saved-view-definition.policy';

const def = (query: string): SavedViewDefinition => ({
  v: 1,
  query,
  sort: null,
  columns: ['a'],
  parts: {},
});

describe('SavedViewDefinitionPolicy', () => {
  const policy = new SavedViewDefinitionPolicy();

  it('should strip search, offset, cursor, limit and withTotal and keep real filters', async () => {
    const out = await policy.normalise(
      'customers',
      def('search=jan%40x.pl&offset=40&cursor=abc&limit=10&withTotal=false')
    );
    expect(out.query).toBe('');
    expect(out.columns).toEqual(['a']);
  });

  it('should reject a filter key the page\'s list DTO does not declare', async () => {
    await expect(policy.normalise('customers', def('bogusFilter=1'))).rejects.toBeInstanceOf(
      InvalidSavedViewError
    );
  });

  it('should reject a value the DTO refuses', async () => {
    await expect(
      policy.normalise('orders', def('sourceConnectionId=not-a-uuid'))
    ).rejects.toMatchObject({ field: 'definition.query' });
  });

  it('should accept a valid filter and persist the sanitised query', async () => {
    const out = await policy.normalise(
      'orders',
      def('sourceConnectionId=11111111-1111-4111-8111-111111111111&search=leak')
    );
    expect(out.query).toBe('sourceConnectionId=11111111-1111-4111-8111-111111111111');
  });

  it('should refuse an unregistered page', async () => {
    await expect(policy.normalise('nope', def(''))).rejects.toBeInstanceOf(InvalidSavedViewError);
  });
});

describe('saved view page registry', () => {
  it('should hold only well-formed keys, each with a list DTO class', () => {
    expect(SAVED_VIEW_PAGE_KEYS.length).toBeGreaterThan(0);
    for (const key of SAVED_VIEW_PAGE_KEYS) {
      expect(key).toMatch(SAVED_VIEW_PAGE_KEY_FORMAT);
      expect(typeof SAVED_VIEW_PAGES[key].queryDto).toBe('function');
    }
  });

  it('should register the pages the first release ships views on', () => {
    expect([...SAVED_VIEW_PAGE_KEYS].sort()).toEqual(
      [
        'customers', 'webhook-deliveries', 'shipments', 'sales-documents', 'returns',
        'invoices', 'sync-jobs', 'products', 'listings', 'orders',
      ].sort()
    );
  });
});
