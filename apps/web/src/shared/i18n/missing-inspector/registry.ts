/**
 * Fallback registry
 *
 * Gives every string that fell back to English a small numeric id the
 * markers carry, and remembers what it was: namespace, key path, the text
 * shown and why. The same key and kind always gets the same id, so a
 * namespace merged again (a language switched back) does not grow the list.
 *
 * @module shared/i18n/missing-inspector
 */
import type { FallbackInfo, FallbackKind, FallbackTagger } from '../merge';
import { encodeMarker } from './markers';

export interface FallbackEntry {
  readonly id: number;
  readonly namespace: string;
  /** Dotted path inside the namespace, e.g. `header.title`. */
  readonly keyPath: string;
  /** The text shown instead of a translation (English, or the `other` form). */
  readonly text: string;
  readonly kind: FallbackKind;
}

export interface FallbackRegistry extends FallbackTagger {
  get(id: number): FallbackEntry | undefined;
}

export function createFallbackRegistry(): FallbackRegistry {
  const byId = new Map<number, FallbackEntry>();
  const byKey = new Map<string, number>();
  return {
    tag(info: FallbackInfo): string {
      const keyPath = info.path.join('.');
      const key = `${info.namespace}\u0000${keyPath}\u0000${info.kind}`;
      let id = byKey.get(key);
      if (id === undefined) {
        id = byId.size;
        byKey.set(key, id);
        byId.set(id, { id, namespace: info.namespace, keyPath, text: info.shown, kind: info.kind });
      }
      return encodeMarker(id, info.shown);
    },
    get: (id) => byId.get(id),
  };
}
