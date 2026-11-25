/**
 * usePinnedViews
 *
 * Which views sit in the strip. A per-viewer convenience, so it lives in
 * localStorage per list rather than on the server, and every access is guarded:
 * storage can be unavailable (private window, blocked site data) and the strip
 * must still render from its defaults.
 *
 * @module apps/web/src/features/saved-views/hooks
 */
import { useCallback, useState } from 'react';

export const MAX_PINNED_VIEWS = 6;

const storageKey = (pageKey: string): string => `ol.saved-views.pinned.${pageKey}`;

function read(pageKey: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(pageKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : null;
  } catch {
    return null;
  }
}

function write(pageKey: string, ids: string[]): void {
  try {
    window.localStorage.setItem(storageKey(pageKey), JSON.stringify(ids));
  } catch {
    // Not persisting a strip layout is acceptable; the in-memory state still applies.
  }
}

export interface UsePinnedViewsResult {
  pinned: string[];
  setPinned: (ids: string[]) => void;
}

export function usePinnedViews(pageKey: string, defaults: string[]): UsePinnedViewsResult {
  const [pinned, setState] = useState<string[]>(() => read(pageKey) ?? defaults);
  const setPinned = useCallback(
    (ids: string[]) => {
      setState(ids);
      write(pageKey, ids);
    },
    [pageKey],
  );
  return { pinned, setPinned };
}
