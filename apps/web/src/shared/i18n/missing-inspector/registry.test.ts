/**
 * Fallback registry and read tracker - unit tests
 *
 * @module shared/i18n/missing-inspector
 */
import { describe, expect, it, vi } from 'vitest';
import { markerIdsIn, stripMarkers } from './markers';
import { createReadTracker } from './read-tracker';
import { createFallbackRegistry } from './registry';

describe('fallback registry', () => {
  it('should give the same key and kind the same id and remember what it was', () => {
    const registry = createFallbackRegistry();
    const first = registry.tag({ namespace: 'orders', path: ['header', 'title'], shown: 'Orders', kind: 'missing' });
    const again = registry.tag({ namespace: 'orders', path: ['header', 'title'], shown: 'Orders', kind: 'missing' });
    const other = registry.tag({ namespace: 'orders', path: ['header', 'title'], shown: 'Orders', kind: 'empty' });

    expect(markerIdsIn(first)).toEqual(markerIdsIn(again));
    expect(markerIdsIn(other)).not.toEqual(markerIdsIn(first));
    expect(stripMarkers(first)).toBe('Orders');
    expect(registry.get(markerIdsIn(first)[0])).toEqual({
      id: markerIdsIn(first)[0],
      namespace: 'orders',
      keyPath: 'header.title',
      text: 'Orders',
      kind: 'missing',
    });
  });
});

describe('read tracker', () => {
  it('should record every marked string read through the tree, nested or not', () => {
    const registry = createFallbackRegistry();
    const marked = registry.tag({ namespace: 'ui', path: ['title'], shown: 'Title', kind: 'missing' });
    const tracker = createReadTracker();
    const listener = vi.fn();
    tracker.onRead(listener);
    const tree = tracker.wrap({ title: marked, plain: 'Tytuł', nested: { title: marked } }) as {
      title: string;
      plain: string;
      nested: { title: string };
    };

    expect(tree.plain).toBe('Tytuł');
    expect(tracker.reads.size).toBe(0);
    expect(tree.nested.title).toBe(marked);
    expect([...tracker.reads]).toEqual(markerIdsIn(marked));
    void tree.title;
    expect(listener).toHaveBeenCalledTimes(1);

    tracker.clear();
    expect(tracker.reads.size).toBe(0);
  });

  it('should return the same proxy for the same object so it is stable as a dependency', () => {
    const tracker = createReadTracker();
    const source = { group: { a: 'A' } };
    const tree = tracker.wrap(source) as typeof source;
    expect(tracker.wrap(source)).toBe(tree);
    expect(tree.group).toBe(tree.group);
  });
});
