/**
 * Rejected cursor writes, remembered in module memory only (#4146, ADR-085)
 *
 * When `PUT /cursor` fails the stored cursor does not move, so the update
 * dialog's "should open" decision would stay true and reopen on every render.
 * Remembering the failed version for the life of the page breaks that loop
 * without touching browser storage (banned for this feature).
 *
 * @module features/release-center/hooks
 */
import { useSyncExternalStore } from 'react';

let rejected = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = rejected;

function emit(): void {
  snapshot = new Set(rejected);
  listeners.forEach((listener) => listener());
}

export function markCursorWriteRejected(version: string): void {
  rejected.add(version);
  emit();
}

export function isCursorWriteRejected(version: string): boolean {
  return rejected.has(version);
}

export function resetCursorWriteMemory(): void {
  rejected = new Set<string>();
  emit();
}

export function useRejectedCursorVersions(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot
  );
}
