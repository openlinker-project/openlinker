import { describe, expect, it } from 'vitest';
import { defaultColumnIds, definitionFromSystemView, reconcileView } from './reconcile-view';
import { testRegistry } from './saved-views.fixtures';
import type { ViewDefinition } from './saved-view.types';

const base: ViewDefinition = { v: 1, query: '', sort: null, columns: ['customer', 'total'], parts: {} };

describe('reconcileView', () => {
  it('should report nothing for a view that still matches the page', () => {
    const result = reconcileView({ ...base, query: 'stage=failed&source=Allegro' }, testRegistry);
    expect(result.issues).toEqual([]);
    expect(result.definition.columns).toEqual(['customer', 'total']);
  });

  it('should skip a column that no longer exists and report it', () => {
    const result = reconcileView({ ...base, columns: ['customer', 'carrierRef', 'total'] }, testRegistry);
    expect(result.definition.columns).toEqual(['customer', 'total']);
    expect(result.issues).toEqual([{ kind: 'unknown-column', columnId: 'carrierRef' }]);
  });

  it('should fall back to the default columns when none survive', () => {
    const result = reconcileView({ ...base, columns: ['gone'] }, testRegistry);
    expect(result.definition.columns).toEqual(defaultColumnIds(testRegistry));
  });

  it('should skip an unknown field and report it once per column', () => {
    const result = reconcileView({ ...base, parts: { total: ['payment', 'vanished', 'gone'] } }, testRegistry);
    expect(result.definition.parts).toEqual({ total: ['payment'] });
    expect(result.issues).toEqual([{ kind: 'unknown-part', columnId: 'total', partIds: ['vanished', 'gone'] }]);
  });

  it('should not store fields that equal the column default', () => {
    const result = reconcileView({ ...base, parts: { total: ['amount', 'payment', 'created'] } }, testRegistry);
    expect(result.definition.parts).toEqual({});
  });

  it('should ignore parts of a column that is gone without a second issue', () => {
    const result = reconcileView({ ...base, columns: ['customer'], parts: { removed: ['a'] } }, testRegistry);
    expect(result.issues).toEqual([]);
  });

  it('should drop an unknown filter and report it', () => {
    const result = reconcileView({ ...base, query: 'stage=failed&retired=1' }, testRegistry);
    expect(result.definition.query).toBe('stage=failed');
    expect(result.issues).toEqual([{ kind: 'unknown-filter', key: 'retired' }]);
  });

  it('should drop a filter value its filter no longer accepts', () => {
    const result = reconcileView({ ...base, query: 'source=Amazon' }, testRegistry);
    expect(result.definition.query).toBe('');
    expect(result.issues).toEqual([{ kind: 'invalid-filter-value', key: 'source', value: 'Amazon' }]);
  });

  it('should replace an unknown sort with the page default and report it', () => {
    const result = reconcileView({ ...base, sort: { key: 'carrier', dir: 'asc' } }, testRegistry);
    expect(result.definition.sort).toEqual(testRegistry.defaultSort);
    expect(result.issues).toEqual([{ kind: 'unknown-sort', key: 'carrier' }]);
  });

  it('should keep a null sort as the page default without an issue', () => {
    expect(reconcileView(base, testRegistry).issues).toEqual([]);
  });

  it('should never throw on a view full of stale references', () => {
    const stale: ViewDefinition = {
      v: 1,
      query: 'a=1&b=2',
      sort: { key: 'x', dir: 'asc' },
      columns: ['p', 'q'],
      parts: { p: ['z'], total: ['nope'] },
    };
    expect(() => reconcileView(stale, testRegistry)).not.toThrow();
  });
});

describe('definitionFromSystemView', () => {
  it('should build a definition with the page defaults a system view leaves unsaid', () => {
    const definition = definitionFromSystemView(testRegistry, { id: 'x', name: 'X', query: 'stage=failed' });
    expect(definition).toEqual({
      v: 1,
      query: 'stage=failed',
      sort: testRegistry.defaultSort,
      columns: ['customer', 'total'],
      parts: {},
    });
  });
});
