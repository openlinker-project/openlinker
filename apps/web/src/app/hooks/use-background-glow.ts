/**
 * useBackgroundGlow
 *
 * The operator's on/off choice for the brand glow behind the app
 * (`DashboardGlow`). Some people find moving light distracting, so it can be
 * switched off from the account menu, next to the theme.
 *
 * Persisted to localStorage under `openlinker-background-glow`, default on.
 * One small store shared through `useSyncExternalStore`, because the switch
 * (in the account menu) and the glow (rendered by the shell) are different
 * components and must flip together without a reload. Another tab changing it
 * is picked up through the `storage` event.
 *
 * @module app/hooks
 */
import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'openlinker-background-glow';

const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let current = read();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY) return;
    current = read();
    emit();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): boolean {
  return current;
}

export function useBackgroundGlow(): [boolean, (next: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, () => true);
  const setEnabled = useCallback((next: boolean) => {
    current = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
    } catch {
      // localStorage unavailable: the choice still applies in this session.
    }
    emit();
  }, []);
  return [enabled, setEnabled];
}
