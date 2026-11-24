/**
 * Per-session dismissal
 *
 * A notice the operator may hide until the tab closes, and no longer: a
 * permanent dismissal would remove the only route to the remedy (the #2255
 * rule). Backed by `sessionStorage` so it survives navigation inside the tab;
 * every storage access is guarded, because storage can be blocked or absent
 * (private windows, previews) and the notice must still render and dismiss.
 *
 * @module shared/hooks
 */
import { useCallback, useState } from 'react';

function readFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function useSessionDismissed(key: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState<boolean>(() => readFlag(key));
  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(key, '1');
    } catch {
      // Storage unavailable: the in-memory flag still hides it for this mount.
    }
  }, [key]);
  return [dismissed, dismiss];
}
