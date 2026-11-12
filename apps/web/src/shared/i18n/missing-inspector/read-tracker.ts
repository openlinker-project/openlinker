/**
 * Read tracker
 *
 * Wraps a merged copy tree so that reading a marked string records its ids,
 * whatever the string is used for afterwards. This is what lets the panel
 * list a fallback that never reaches the page: a document title, a confirm
 * dialog, a file name, a canvas chart, a toast that is already gone.
 *
 * Each object gets one proxy, cached, so the tree a hook returns stays the
 * same object across renders and is still safe as a dependency.
 *
 * @module shared/i18n/missing-inspector
 */
import { markerIdsIn } from './markers';

export interface ReadTracker {
  wrap(tree: unknown): unknown;
  /** Ids read since the last `clear`. */
  readonly reads: ReadonlySet<number>;
  clear(): void;
  /** Called after a read that added an id the set did not hold. */
  onRead(listener: () => void): void;
}

export function createReadTracker(): ReadTracker {
  const reads = new Set<number>();
  const proxies = new WeakMap<object, object>();
  let listener: (() => void) | null = null;

  const record = (value: string): void => {
    let added = false;
    for (const id of markerIdsIn(value)) {
      if (!reads.has(id)) {
        reads.add(id);
        added = true;
      }
    }
    if (added) listener?.();
  };

  const wrap = (tree: unknown): unknown => {
    if (typeof tree !== 'object' || tree === null) return tree;
    const cached = proxies.get(tree);
    if (cached !== undefined) return cached;
    const proxy = new Proxy(tree, {
      get(target, key, receiver): unknown {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof key === 'symbol') return value;
        if (typeof value === 'string') {
          record(value);
          return value;
        }
        return wrap(value);
      },
    });
    proxies.set(tree, proxy);
    return proxy;
  };

  return {
    wrap,
    reads,
    clear: () => reads.clear(),
    onRead: (next): void => {
      listener = next;
    },
  };
}
